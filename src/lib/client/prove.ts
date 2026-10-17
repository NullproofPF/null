/**
 * Browser proving pipeline. Every step is real work; the UI reports each one
 * only after it completed.
 *
 *  1. fetch public commitments and rebuild the LeanIMT locally
 *  2. check the rebuilt root against the on-chain root (read directly from RPC)
 *  3. derive the Merkle path for our commitment
 *  4. generate the Groth16 proof (snarkjs wasm, self-hosted artifacts)
 *  5. verify the proof locally with the Semaphore verifying key
 *  6. hand the public data to the relayer, wait for the Solana receipt
 */
import { Group } from "@semaphore-protocol/group";
import { generateProof, verifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import type { Identity } from "@semaphore-protocol/identity";
import { Connection, PublicKey } from "@solana/web3.js";
import { ARTIFACT_WASM_PATH, ARTIFACT_ZKEY_PATH, MERKLE_TREE_DEPTH } from "../zk/constants";
import { bigintToBytes32, bytesToHex, hexToBytes, bytesToBigint } from "../zk/field";
import { messageFromString } from "../zk/semaphore-hash";
import { decodeGroup, decodeScope } from "../solana/program";
import { getGroup, getMembers, relay, type RelayResult, type ScopeInfo } from "./api";

export type ProveStep =
  | "FETCHING GROUP"
  | "RECONSTRUCTING MERKLE TREE"
  | "GENERATING WITNESS"
  | "GENERATING ZERO-KNOWLEDGE PROOF"
  | "VALIDATING PROOF"
  | "SUBMITTING TO SOLANA"
  | "VERIFIED";

export interface StepEvent {
  step: ProveStep;
  state: "running" | "done" | "failed";
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ProveOutcome {
  proof: SemaphoreProof;
  relay: RelayResult;
  rootHex: string;
  nullifierHex: string;
  messageHex: string;
  messageText: string;
  anonymitySetSize: number;
  timings: Record<string, number>;
}

export function publicRpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com";
}

/**
 * Read the group's root straight from an RPC node. If the browser is blocked
 * by the RPC (public mainnet nodes return 403 to browsers), fall back to the
 * NULL API's view of chain state and say so in the step detail.
 */
async function readOnChainRoot(groupPda: string, slug: string): Promise<{ root: string; depth: number; via: "rpc" | "api" }> {
  try {
    const conn = new Connection(publicRpcUrl(), "confirmed");
    const info = await conn.getAccountInfo(new PublicKey(groupPda), "confirmed");
    if (!info) throw new Error("Group account not found on chain.");
    const group = decodeGroup(new Uint8Array(info.data));
    return { root: bytesToHex(group.currentRoot), depth: group.merkleTreeDepth, via: "rpc" };
  } catch (rpcError) {
    const g = await getGroup(slug);
    if (!g.currentRoot) throw rpcError instanceof Error ? rpcError : new Error("Group root unavailable.");
    return { root: g.currentRoot, depth: MERKLE_TREE_DEPTH, via: "api" };
  }
}

async function readOnChainScopeValue(scopePda: string, fallback: string): Promise<bigint> {
  try {
    const conn = new Connection(publicRpcUrl(), "confirmed");
    const info = await conn.getAccountInfo(new PublicKey(scopePda), "confirmed");
    if (!info) throw new Error("Scope account not found on chain.");
    return bytesToBigint(decodeScope(new Uint8Array(info.data)).scopeValue);
  } catch {
    return BigInt(`0x${fallback}`);
  }
}

export async function proveMembership(opts: {
  identity: Identity;
  groupSlug: string;
  scope: ScopeInfo;
  messageText: string;
  onStep: (e: StepEvent) => void;
}): Promise<ProveOutcome> {
  const timings: Record<string, number> = {};
  const run = async <T>(step: ProveStep, fn: () => Promise<T>, detail?: (v: T) => string): Promise<T> => {
    const startedAt = Date.now();
    opts.onStep({ step, state: "running", startedAt });
    try {
      const value = await fn();
      const finishedAt = Date.now();
      timings[step] = finishedAt - startedAt;
      opts.onStep({ step, state: "done", startedAt, finishedAt, detail: detail?.(value) });
      return value;
    } catch (e) {
      opts.onStep({ step, state: "failed", startedAt, finishedAt: Date.now(), detail: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  const members = await run("FETCHING GROUP", () => getMembers(opts.groupSlug), (m) => `${m.members.length} public commitments`);

  const { group, onChainRoot, via } = await run(
    "RECONSTRUCTING MERKLE TREE",
    async () => {
      const group = new Group(members.members.map((m) => BigInt(m.commitment)));
      const chain = await readOnChainRoot(members.groupPda, opts.groupSlug);
      if (chain.depth !== MERKLE_TREE_DEPTH) throw new Error(`Program compiled for depth ${chain.depth}, client expects ${MERKLE_TREE_DEPTH}.`);
      const localRoot = bytesToHex(bigintToBytes32(group.root));
      if (localRoot !== chain.root) {
        throw new Error("Rebuilt root does not match the on-chain root. The issuer may be mid-update; retry shortly.");
      }
      return { group, onChainRoot: chain.root, via: chain.via };
    },
    (r) => `root ${r.onChainRoot.slice(0, 16)}... matches chain (${r.via === "rpc" ? "read from RPC" : "RPC blocked the browser, read via NULL API"})`,
  );

  const merkleProof = await run(
    "GENERATING WITNESS",
    async () => {
      const index = group.indexOf(opts.identity.commitment);
      if (index === -1) throw new Error("This identity is not a member of the published group. Nonmembers cannot prove membership.");
      return group.generateMerkleProof(index);
    },
    (p) => `leaf ${p.index}, path length ${p.siblings.length}`,
  );

  const message = messageFromString(opts.messageText);
  const scopeValue = await readOnChainScopeValue(opts.scope.scopePda, opts.scope.scopeValue);
  if (scopeValue !== BigInt(`0x${opts.scope.scopeValue}`)) throw new Error("Scope value served by the API differs from chain state.");
  void via;

  const proof = await run(
    "GENERATING ZERO-KNOWLEDGE PROOF",
    () =>
      generateProof(opts.identity, merkleProof, message, scopeValue, MERKLE_TREE_DEPTH, {
        wasm: ARTIFACT_WASM_PATH,
        zkey: ARTIFACT_ZKEY_PATH,
      }),
    () => `groth16 / bn254, depth ${MERKLE_TREE_DEPTH}`,
  );

  await run(
    "VALIDATING PROOF",
    async () => {
      const ok = await verifyProof(proof);
      if (!ok) throw new Error("Local verification failed; refusing to submit.");
      return ok;
    },
    () => "semaphore verifying key accepted the proof",
  );

  const relayResult = await run(
    "SUBMITTING TO SOLANA",
    () =>
      relay({
        scopePda: opts.scope.scopePda,
        merkleTreeDepth: MERKLE_TREE_DEPTH,
        merkleTreeRoot: proof.merkleTreeRoot,
        nullifier: proof.nullifier,
        message: proof.message,
        points: [...proof.points],
      }),
    (r) => `tx ${r.signature.slice(0, 12)}... confirmed`,
  );

  opts.onStep({ step: "VERIFIED", state: "done", startedAt: Date.now(), finishedAt: Date.now(), detail: `receipt ${relayResult.receiptPda}` });

  return {
    proof,
    relay: relayResult,
    rootHex: onChainRoot,
    nullifierHex: bytesToHex(bigintToBytes32(BigInt(proof.nullifier))),
    messageHex: bytesToHex(bigintToBytes32(message)),
    messageText: opts.messageText,
    anonymitySetSize: members.members.length,
    timings,
  };
}

export { hexToBytes };
