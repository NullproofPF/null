/**
 * Generates deterministic cross-language test fixtures:
 *   - two member identities (alice, bob) and one nonmember (carol)
 *   - a NULL GENESIS-style group and two scopes (a: one-time, b: one-time)
 *   - real Groth16 proofs (Semaphore v4, depth 16) in Solana byte layout
 *   - hash vectors for semaphore_hash / derive_scope_value
 *
 * Every proof is checked with Semaphore's verifier AND the noble pairing oracle
 * before it is written. Output: program/tests/fixtures/semaphore-fixtures.json
 *
 *   npx tsx scripts/gen-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import { MERKLE_TREE_DEPTH } from "../src/lib/zk/constants";
import { bigintToBytes32, bytesToHex, parseBigint } from "../src/lib/zk/field";
import {
  deriveScopeValue,
  groupIdFromLabel,
  messageFromString,
  scopeIdFromLabel,
  semaphoreHash,
} from "../src/lib/zk/semaphore-hash";
import { buildPublicInputs, semaphorePointsToSolanaProof, type PackedPoints } from "../src/lib/zk/solana-proof";
import { groupPda, programId, scopePda } from "../src/lib/solana/program";
import { solanaStyleGroth16Check } from "./lib/pairing-oracle";
import { toSolanaVerifyingKey, verificationKeyForDepth } from "./lib/verifying-key";

const ARTIFACTS = {
  wasm: path.resolve(process.cwd(), `public/artifacts/semaphore-${MERKLE_TREE_DEPTH}.wasm`),
  zkey: path.resolve(process.cwd(), `public/artifacts/semaphore-${MERKLE_TREE_DEPTH}.zkey`),
};

const hex32 = (v: bigint | string) => bytesToHex(bigintToBytes32(parseBigint(v)));

interface ProofFixture {
  label: string;
  identity: string;
  scope: string;
  messageText: string;
  root: string;
  nullifier: string;
  message: string;
  scopeValue: string;
  proof: string;
  points: string[];
  semaphoreProof: SemaphoreProof;
}

async function prove(
  label: string,
  identityName: string,
  identity: Identity,
  group: Group,
  scopeName: string,
  scopeValue: bigint,
  messageText: string,
  vk: ReturnType<typeof toSolanaVerifyingKey>,
): Promise<ProofFixture> {
  const message = messageFromString(messageText);
  const t0 = Date.now();
  const proof = await generateProof(identity, group, message, scopeValue, MERKLE_TREE_DEPTH, ARTIFACTS);
  const ms = Date.now() - t0;
  const ok = await verifyProof(proof);
  if (!ok) throw new Error(`${label}: semaphore verifyProof returned false`);
  const solanaProof = semaphorePointsToSolanaProof(proof.points as PackedPoints);
  const inputs = buildPublicInputs({
    merkleTreeRoot: proof.merkleTreeRoot,
    nullifier: proof.nullifier,
    message,
    scope: scopeValue,
  });
  if (!solanaStyleGroth16Check(solanaProof, inputs, vk)) {
    throw new Error(`${label}: noble oracle rejected the Solana-encoded proof`);
  }
  // Tamper check: flipping one byte of C must break it.
  const tampered = new Uint8Array(solanaProof);
  tampered[200] ^= 0x01;
  let tamperedAccepted = false;
  try {
    tamperedAccepted = solanaStyleGroth16Check(tampered, inputs, vk);
  } catch {
    tamperedAccepted = false;
  }
  if (tamperedAccepted) throw new Error(`${label}: tampered proof accepted by oracle`);
  console.log(`  ${label}: proved in ${ms} ms, semaphore ok, oracle ok, tamper rejected`);
  return {
    label,
    identity: identityName,
    scope: scopeName,
    messageText,
    root: hex32(proof.merkleTreeRoot),
    nullifier: hex32(proof.nullifier),
    message: hex32(message),
    scopeValue: hex32(scopeValue),
    proof: bytesToHex(solanaProof),
    points: [...proof.points],
    semaphoreProof: proof,
  };
}

async function main() {
  const pid = programId();
  const vk = toSolanaVerifyingKey(verificationKeyForDepth(MERKLE_TREE_DEPTH));

  const alice = new Identity("null-fixture-alice");
  const bob = new Identity("null-fixture-bob");
  const carol = new Identity("null-fixture-carol");

  const group = new Group([alice.commitment, bob.commitment]);
  const groupId = groupIdFromLabel("null-test-group");
  const [groupPk] = groupPda(groupId, pid);

  const scopes: Record<string, { scopeId: Uint8Array; scopeValue: bigint; pda: string; oneTime: boolean }> = {};
  for (const [name, oneTime] of [
    ["a", true],
    ["b", true],
    ["c", false],
  ] as const) {
    const scopeId = scopeIdFromLabel(`scope-${name}`);
    const scopeValue = deriveScopeValue(groupPk.toBytes(), scopeId);
    const [pda] = scopePda(groupPk, scopeId, pid);
    scopes[name] = { scopeId, scopeValue, pda: pda.toBase58(), oneTime };
  }

  console.log(`program ${pid.toBase58()}, group ${groupPk.toBase58()}, root ${group.root}`);
  console.log("generating proofs (depth 16)...");

  const proofs: ProofFixture[] = [];
  proofs.push(await prove("alice_scope_a", "alice", alice, group, "a", scopes.a.scopeValue, "vote:yes", vk));
  proofs.push(await prove("bob_scope_a", "bob", bob, group, "a", scopes.a.scopeValue, "vote:no", vk));
  proofs.push(await prove("alice_scope_b", "alice", alice, group, "b", scopes.b.scopeValue, "access:granted", vk));
  proofs.push(
    await prove("alice_scope_a_other_message", "alice", alice, group, "a", scopes.a.scopeValue, "vote:no", vk),
  );
  proofs.push(await prove("alice_scope_c", "alice", alice, group, "c", scopes.c.scopeValue, "ping", vk));

  // Nullifier sanity: same identity + same scope => same nullifier, regardless of message.
  if (proofs[0].nullifier !== proofs[3].nullifier) throw new Error("nullifier should not depend on message");
  if (proofs[0].nullifier === proofs[2].nullifier) throw new Error("nullifier should depend on scope");
  if (proofs[0].nullifier === proofs[1].nullifier) throw new Error("nullifier should depend on identity");

  // Nonmember: Semaphore refuses to build a Merkle proof for a commitment not in the group.
  let nonmemberError = "";
  try {
    await generateProof(carol, group, messageFromString("vote:yes"), scopes.a.scopeValue, MERKLE_TREE_DEPTH, ARTIFACTS);
    throw new Error("nonmember proof generation unexpectedly succeeded");
  } catch (e) {
    nonmemberError = e instanceof Error ? e.message : String(e);
    console.log(`  carol (nonmember) cannot prove: ${nonmemberError}`);
  }

  // Forged tree: carol adds herself to a private copy of the tree. The proof is
  // cryptographically valid but for a root the issuer never published.
  const forgedGroup = new Group([alice.commitment, bob.commitment, carol.commitment]);
  const forged = await prove("carol_forged_root", "carol", carol, forgedGroup, "a", scopes.a.scopeValue, "vote:yes", vk);
  if (forged.root === hex32(group.root)) throw new Error("forged root should differ");

  const hashVectors = [0n, 1n, 2n ** 64n - 1n, group.root, scopes.a.scopeValue].map((v) => ({
    input: hex32(v),
    semaphoreHash: hex32(semaphoreHash(v)),
  }));

  const fixtures = {
    generatedAt: new Date().toISOString(),
    programId: pid.toBase58(),
    merkleTreeDepth: MERKLE_TREE_DEPTH,
    groupLabel: "null-test-group",
    groupId: bytesToHex(groupId),
    groupPda: groupPk.toBase58(),
    members: [alice.commitment.toString(), bob.commitment.toString()],
    membersHex: [hex32(alice.commitment), hex32(bob.commitment)],
    nonmemberCommitment: carol.commitment.toString(),
    root: hex32(group.root),
    rootDecimal: group.root.toString(),
    forgedRoot: forged.root,
    scopes: Object.fromEntries(
      Object.entries(scopes).map(([k, v]) => [
        k,
        { scopeId: bytesToHex(v.scopeId), scopeValue: hex32(v.scopeValue), scopePda: v.pda, oneTime: v.oneTime },
      ]),
    ),
    proofs: Object.fromEntries(proofs.map((p) => [p.label, p])),
    forged,
    nonmemberError,
    hashVectors,
  };

  const out = path.resolve(process.cwd(), "program/tests/fixtures/semaphore-fixtures.json");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(fixtures, null, 2));
  console.log(`wrote ${out}`);
}

main()
  .then(() => {
    // snarkjs keeps its worker pool alive; exit explicitly.
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
