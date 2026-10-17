/**
 * End-to-end demonstration against the deployed program on a TEST cluster, exercising the
 * exact server code paths the web app uses (issuer + relayer) plus browser-side
 * proof generation (Semaphore v4, self-hosted artifacts).
 *
 *   npx tsx --env-file=.env.local scripts/demo-e2e.ts
 *
 * Refuses to run against mainnet-beta: it enrolls throwaway identities, which would
 * pad the real group's anonymity set. Writes artifacts/<cluster>-evidence.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof } from "@semaphore-protocol/proof";
import { PublicKey } from "@solana/web3.js";
import { MERKLE_TREE_DEPTH } from "../src/lib/zk/constants";
import { bigintToBytes32, bytesToBigint, bytesToHex, hexToBytes } from "../src/lib/zk/field";
import { messageFromString } from "../src/lib/zk/semaphore-hash";
import { semaphorePointsToSolanaProof, type PackedPoints } from "../src/lib/zk/solana-proof";
import { verifyProofIx } from "../src/lib/solana/program";
import {
  createInvitations,
  createScope,
  enroll,
  listMembers,
  publishRoot,
  registerGroup,
  type ScopeRow,
} from "../src/lib/server/issuer";
import { relayProof, type RelayResult } from "../src/lib/server/relayer";
import { HttpError } from "../src/lib/server/http";
import { explorerTxUrl, relayerKeypair } from "../src/lib/server/env";
import { describeProgramError, fetchGroupAccount, fetchScopeAccount, lamportsOf, sendAndConfirm } from "../src/lib/server/solana";
import { getPool } from "../src/lib/server/db";

const SLUG = "null-genesis";
const ARTIFACTS = {
  wasm: path.resolve(process.cwd(), `public/artifacts/semaphore-${MERKLE_TREE_DEPTH}.wasm`),
  zkey: path.resolve(process.cwd(), `public/artifacts/semaphore-${MERKLE_TREE_DEPTH}.zkey`),
};

interface Evidence {
  step: string;
  outcome: "ok" | "rejected";
  detail: string;
  signature?: string;
  explorerUrl?: string;
}

const evidence: Evidence[] = [];
const log = (e: Evidence) => {
  evidence.push(e);
  const tag = e.outcome === "ok" ? "OK " : "REJ";
  console.log(`[${tag}] ${e.step}: ${e.detail}${e.signature ? `\n      ${e.explorerUrl}` : ""}`);
};

async function expectReject(step: string, fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await fn();
    throw new Error(`${step}: expected rejection but it succeeded`);
  } catch (e) {
    if (e instanceof Error && /expected rejection/.test(e.message)) throw e;
    const text = e instanceof HttpError ? `${e.status} ${e.message}` : e instanceof Error ? e.message : String(e);
    if (!pattern.test(text)) throw new Error(`${step}: rejected for the wrong reason: ${text}`);
    log({ step, outcome: "rejected", detail: text });
  }
}

async function prove(identity: Identity, members: { commitment: string }[], scope: ScopeRow, messageText: string) {
  const group = new Group(members.map((m) => BigInt(m.commitment)));
  const scopeValue = bytesToBigint(hexToBytes(scope.scope_value));
  const message = messageFromString(messageText);
  const t0 = Date.now();
  const proof = await generateProof(identity, group, message, scopeValue, MERKLE_TREE_DEPTH, ARTIFACTS);
  return { proof, ms: Date.now() - t0, message };
}

async function relay(proof: Awaited<ReturnType<typeof prove>>["proof"], scope: ScopeRow): Promise<RelayResult> {
  return relayProof({
    scopePda: scope.scope_pda,
    merkleTreeDepth: MERKLE_TREE_DEPTH,
    merkleTreeRoot: proof.merkleTreeRoot,
    nullifier: proof.nullifier,
    message: proof.message,
    points: [...proof.points],
  });
}

async function main() {
  if ((process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") === "mainnet-beta") {
    throw new Error("demo-e2e enrolls throwaway identities; run it against devnet (NULL_CLUSTER=devnet node tools/write-env.mjs), never the mainnet registry.");
  }
  const relayer = relayerKeypair();
  const startLamports = await lamportsOf(relayer.publicKey);
  console.log(`relayer/issuer ${relayer.publicKey.toBase58()} balance ${(startLamports / 1e9).toFixed(4)} SOL`);

  // 1. Administrator creates NULL GENESIS (idempotent).
  const groupRow = await registerGroup({ slug: SLUG, name: "NULL GENESIS" });
  const groupPk = new PublicKey(groupRow.group_pda);
  log({ step: "1 administrator creates NULL GENESIS", outcome: "ok", detail: `group PDA ${groupRow.group_pda}` });

  const voteScope = await createScope(SLUG, "genesis-vote", true);
  const accessScope = await createScope(SLUG, "genesis-access", false);
  log({ step: "scopes configured", outcome: "ok", detail: `genesis-vote (one-time) ${voteScope.scope_pda}; genesis-access (multi-use) ${accessScope.scope_pda}` });

  // 2. Administrator generates invitation codes.
  const codes = await createInvitations(SLUG, 2, "demo-e2e");
  log({ step: "2 administrator generates invitations", outcome: "ok", detail: `${codes.length} single-use codes minted (hashes stored only)` });

  // 3 + 4. Alice and Bob create secret identities locally.
  const alice = new Identity();
  const bob = new Identity();
  const carol = new Identity();
  log({ step: "3 alice creates identity", outcome: "ok", detail: `commitment ${alice.commitment}` });
  log({ step: "4 bob creates identity", outcome: "ok", detail: `commitment ${bob.commitment}` });

  // 5. Both redeem separate invitations with commitments only.
  const a = await enroll(SLUG, codes[0], alice.commitment.toString());
  const b = await enroll(SLUG, codes[1], bob.commitment.toString());
  log({ step: "5 alice and bob redeem invitations", outcome: "ok", detail: `leaf ${a.leafIndex} and leaf ${b.leafIndex}, pending root publication` });
  await expectReject("invitation reuse", () => enroll(SLUG, codes[0], carol.commitment.toString()), /already used/);
  await expectReject("unknown invitation", () => enroll(SLUG, "NULL-AAAAA-BBBBB-CCCCC", carol.commitment.toString()), /not recognized/);

  // 6. Administrator publishes the updated membership root to Solana.
  const published = await publishRoot(SLUG);
  log({
    step: "6 administrator publishes root",
    outcome: "ok",
    detail: `root ${published.root} (${published.memberCount} members)`,
    signature: published.signature ?? undefined,
    explorerUrl: published.signature ? explorerTxUrl(published.signature) : undefined,
  });
  const onChain = await fetchGroupAccount(groupPk);
  if (!onChain || bytesToHex(onChain.currentRoot) !== published.root) throw new Error("on-chain root does not match published root");

  const members = (await listMembers(SLUG)).filter((m) => m.status === "included");

  // 7 + 8 + 9. Alice proves anonymously; program validates; receipt lands.
  const aliceVote = await prove(alice, members, voteScope, "vote:yes");
  const aliceRelay = await relay(aliceVote.proof, voteScope);
  log({
    step: "7-9 alice proves membership (genesis-vote)",
    outcome: "ok",
    detail: `proved in ${aliceVote.ms} ms; receipt ${aliceRelay.receiptPda} index ${aliceRelay.receiptIndex}; nullifier ${aliceRelay.nullifier}`,
    signature: aliceRelay.signature,
    explorerUrl: aliceRelay.explorerUrl,
  });

  // Replays: exact same proof, and a fresh proof with another message in the same one-time scope.
  await expectReject("replay of the same proof", () => relay(aliceVote.proof, voteScope), /nullifier already consumed/);
  const aliceVoteAgain = await prove(alice, members, voteScope, "vote:no");
  if (aliceVoteAgain.proof.nullifier !== aliceVote.proof.nullifier) throw new Error("nullifier should be stable per scope");
  await expectReject("second action in one-time scope", () => relay(aliceVoteAgain.proof, voteScope), /nullifier already consumed/);

  // Bob can still act in the same scope: same root, different nullifier.
  const bobVote = await prove(bob, members, voteScope, "vote:no");
  const bobRelay = await relay(bobVote.proof, voteScope);
  if (bobRelay.nullifier === aliceRelay.nullifier) throw new Error("bob and alice must have distinct nullifiers");
  log({
    step: "bob proves membership (genesis-vote)",
    outcome: "ok",
    detail: `receipt ${bobRelay.receiptPda}; nullifier ${bobRelay.nullifier}`,
    signature: bobRelay.signature,
    explorerUrl: bobRelay.explorerUrl,
  });

  // A new scope permits another action by alice; multi-use scope accepts repeats.
  const aliceAccess = await prove(alice, members, accessScope, "access:door-1");
  const aliceAccessRelay = await relay(aliceAccess.proof, accessScope);
  log({
    step: "alice acts in a new scope (genesis-access)",
    outcome: "ok",
    detail: `receipt ${aliceAccessRelay.receiptPda}; nullifier ${aliceAccessRelay.nullifier} differs from vote nullifier`,
    signature: aliceAccessRelay.signature,
    explorerUrl: aliceAccessRelay.explorerUrl,
  });
  const aliceAccess2 = await prove(alice, members, accessScope, "access:door-2");
  const aliceAccess2Relay = await relay(aliceAccess2.proof, accessScope);
  log({
    step: "alice repeats in multi-use scope",
    outcome: "ok",
    detail: `receipt ${aliceAccess2Relay.receiptPda}; same nullifier counted again`,
    signature: aliceAccess2Relay.signature,
    explorerUrl: aliceAccess2Relay.explorerUrl,
  });

  // Nonmember: cannot even build a Merkle proof for the published tree.
  await expectReject("nonmember proof generation", () => prove(carol, members, voteScope, "vote:yes"), /does not exist in this tree/);
  // Nonmember with a forged tree: valid proof, unpublished root.
  const forged = await prove(carol, [...members, { commitment: carol.commitment.toString() }], voteScope, "vote:yes");
  await expectReject("forged root", () => relay(forged.proof, voteScope), /not published/);

  // Invalid proof: tampered point rejected off-chain by the relayer...
  const tampered = { ...bobVote.proof, points: [...bobVote.proof.points] as string[] };
  tampered.points[7] = (BigInt(tampered.points[7]) + 1n).toString();
  await expectReject("tampered proof (relayer)", () => relay(tampered as never, voteScope), /failed off-chain verification|not a scalar|rejected/);

  // ...and by the program itself when submitted directly (bypassing the relayer checks).
  const scopeState = (await fetchScopeAccount(new PublicKey(voteScope.scope_pda)))!;
  const directIx = verifyProofIx({
    payer: relayer.publicKey,
    group: groupPk,
    scope: new PublicKey(voteScope.scope_pda),
    receiptIndex: scopeState.verificationCount,
    root: hexToBytes(published.root),
    nullifier: bigintToBytes32(BigInt(forged.proof.nullifier)),
    message: bigintToBytes32(forged.message),
    proof: semaphorePointsToSolanaProof(bobVote.proof.points as PackedPoints),
  });
  await expectReject(
    "mismatched proof submitted directly to the program",
    () => sendAndConfirm([directIx], relayer, [], 400_000).catch((e) => Promise.reject(new Error(describeProgramError(e)))),
    /InvalidProof|6007|custom program error/,
  );

  const endLamports = await lamportsOf(relayer.publicKey);
  const summary = {
    generatedAt: new Date().toISOString(),
    cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    programId: process.env.NEXT_PUBLIC_NULL_PROGRAM_ID,
    group: { slug: SLUG, pda: groupRow.group_pda, root: published.root, members: members.length },
    scopes: { vote: voteScope.scope_pda, access: accessScope.scope_pda },
    spentSol: (startLamports - endLamports) / 1e9,
    evidence,
  };
  const evidenceFile = `artifacts/${summary.cluster}-evidence.json`;
  mkdirSync(path.resolve(process.cwd(), "artifacts"), { recursive: true });
  writeFileSync(path.resolve(process.cwd(), evidenceFile), JSON.stringify(summary, null, 2));
  console.log(`\nspent ${summary.spentSol.toFixed(5)} SOL; evidence written to ${evidenceFile}`);
  console.log("observer view: receipts expose root + nullifier + message only; alice and bob are indistinguishable from the public data.");
}

main()
  .then(async () => {
    await getPool().end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("E2E FAILED:", e instanceof Error ? e.message : e);
    try {
      await getPool().end();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
