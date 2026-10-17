/**
 * Sponsored transaction relayer. Pays the fee for verify_proof so the prover
 * never has to reveal a funded wallet. The relayer receives only the proof
 * and its public inputs: never an identity secret, never a Merkle path.
 *
 * Abuse protection: per-caller hourly buckets keyed by a salted IP hash
 * (purged after two hours), a global per-minute cap, an off-chain Groth16
 * check before any lamport is spent, and a minimum relayer balance.
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { verifyProof as semaphoreVerifyProof, type SemaphoreProof } from "@semaphore-protocol/proof";
import type { NumericString } from "snarkjs";
import { query } from "./db";
import { RELAY_GLOBAL_LIMIT_PER_MINUTE, RELAY_LIMIT_PER_HOUR, RELAYER_MIN_LAMPORTS, explorerTxUrl, relayerKeypair } from "./env";
import { HttpError } from "./http";
import { getGroupRow, getScopeRow } from "./issuer";
import { describeProgramError, fetchGroupAccount, fetchScopeAccount, getConnection, lamportsOf, sendAndConfirm } from "./solana";
import { MERKLE_TREE_DEPTH } from "../zk/constants";
import { bigintToBytes32, bytesToBigint, bytesToHex, hexToBytes, isScalarFieldElement, parseBigint } from "../zk/field";
import { semaphorePointsToSolanaProof, type PackedPoints } from "../zk/solana-proof";
import { nullifierRecordPda, receiptPda, verifyProofIx } from "../solana/program";

/** Compute budget for verify_proof. Measured 134k CU in LiteSVM; headroom for runtime differences. */
export const VERIFY_COMPUTE_UNITS = 400_000;

export interface RelayRequest {
  scopePda: string;
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  nullifier: string;
  message: string;
  points: string[];
}

export interface RelayResult {
  signature: string;
  explorerUrl: string;
  receiptPda: string;
  receiptIndex: number;
  slot: number | null;
  root: string;
  nullifier: string;
  message: string;
  scopePda: string;
  groupSlug: string;
}

function hex32FromAny(raw: string, name: string): { bytes: Uint8Array; decimal: string } {
  let value: bigint;
  try {
    value = parseBigint(raw);
  } catch {
    throw new HttpError(400, `${name} must be a decimal or 0x-hex string`);
  }
  if (!isScalarFieldElement(value)) throw new HttpError(400, `${name} is not a scalar field element`);
  return { bytes: bigintToBytes32(value), decimal: value.toString() };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function bucketKey(clientAddress: string): string {
  const salt = process.env.RELAY_SALT ?? "null-relay";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${salt}:${day}:${clientAddress}`).digest("hex").slice(0, 32);
}

async function consumeBucket(key: string, windowMs: number, limit: number): Promise<void> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const rows = await query<{ count: number }>(
    `insert into relay_rate_limits (bucket_key, window_start, count) values ($1, $2, 1)
     on conflict (bucket_key, window_start) do update set count = relay_rate_limits.count + 1
     returning count`,
    [key, windowStart],
  );
  if (rows[0].count > limit) throw new HttpError(429, "relayer rate limit reached, try again later");
}

async function purgeOldBuckets(): Promise<void> {
  if (Math.random() < 0.1) {
    await query("delete from relay_rate_limits where window_start < now() - interval '2 hours'");
  }
}

export async function enforceRateLimits(clientAddress: string): Promise<void> {
  await purgeOldBuckets();
  await consumeBucket("global", 60_000, RELAY_GLOBAL_LIMIT_PER_MINUTE);
  await consumeBucket(bucketKey(clientAddress), 3_600_000, RELAY_LIMIT_PER_HOUR);
}

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------

export function parseRelayRequest(body: unknown): RelayRequest {
  if (!body || typeof body !== "object") throw new HttpError(400, "body must be an object");
  const b = body as Record<string, unknown>;
  if (typeof b.scopePda !== "string") throw new HttpError(400, "scopePda required");
  if (b.merkleTreeDepth !== MERKLE_TREE_DEPTH) throw new HttpError(400, `merkleTreeDepth must be ${MERKLE_TREE_DEPTH}`);
  for (const k of ["merkleTreeRoot", "nullifier", "message"]) {
    if (typeof b[k] !== "string") throw new HttpError(400, `${k} required`);
  }
  if (!Array.isArray(b.points) || b.points.length !== 8 || !b.points.every((p) => typeof p === "string" && /^[0-9]{1,80}$/.test(p))) {
    throw new HttpError(400, "points must be 8 decimal strings");
  }
  return {
    scopePda: b.scopePda,
    merkleTreeDepth: MERKLE_TREE_DEPTH,
    merkleTreeRoot: b.merkleTreeRoot as string,
    nullifier: b.nullifier as string,
    message: b.message as string,
    points: b.points as string[],
  };
}

export async function relayProof(req: RelayRequest): Promise<RelayResult> {
  const relayer = relayerKeypair();
  const balance = await lamportsOf(relayer.publicKey);
  if (balance < RELAYER_MIN_LAMPORTS) throw new HttpError(503, "relayer is out of funds");

  let scopePk: PublicKey;
  try {
    scopePk = new PublicKey(req.scopePda);
  } catch {
    throw new HttpError(400, "scopePda is not a valid address");
  }
  const scopeRow = await getScopeRow(req.scopePda);
  const groupRow = await getGroupRow(scopeRow.group_slug);
  const groupPk = new PublicKey(groupRow.group_pda);

  const [onChainGroup, onChainScope] = await Promise.all([fetchGroupAccount(groupPk), fetchScopeAccount(scopePk)]);
  if (!onChainGroup || !onChainScope) throw new HttpError(502, "on-chain group or scope account missing");
  if (!onChainScope.group.equals(groupPk)) throw new HttpError(500, "scope/group mismatch in registry");

  const root = hex32FromAny(req.merkleTreeRoot, "merkleTreeRoot");
  const nullifier = hex32FromAny(req.nullifier, "nullifier");
  const message = hex32FromAny(req.message, "message");
  const scopeValue = bytesToBigint(onChainScope.scopeValue);

  // Root must be one the program will accept: current or still inside the history window.
  const rootHex = bytesToHex(root.bytes);
  const known =
    bytesToHex(onChainGroup.currentRoot) === rootHex ||
    onChainGroup.rootHistory.some((e) => e.publishedSlot !== 0n && bytesToHex(e.root) === rootHex);
  if (!known) throw new HttpError(409, "merkle root is not published for this group (refresh the member list and prove again)");

  // Off-chain verification with the exact Semaphore verifying key, before spending fees.
  const semaphoreProof: SemaphoreProof = {
    merkleTreeDepth: MERKLE_TREE_DEPTH,
    merkleTreeRoot: root.decimal as NumericString,
    nullifier: nullifier.decimal as NumericString,
    message: message.decimal as NumericString,
    scope: scopeValue.toString() as NumericString,
    points: req.points as unknown as SemaphoreProof["points"],
  };
  let valid = false;
  try {
    valid = await semaphoreVerifyProof(semaphoreProof);
  } catch {
    valid = false;
  }
  if (!valid) throw new HttpError(400, "proof failed off-chain verification");

  // Nullifier policy preview (the program is the authority; this gives a clean error).
  if (onChainScope.oneTime) {
    const [recordPk] = nullifierRecordPda(scopePk, nullifier.bytes);
    const record = await getConnection().getAccountInfo(recordPk, "confirmed");
    if (record) throw new HttpError(409, "nullifier already consumed in this one-time scope");
  }

  const proofBytes = semaphorePointsToSolanaProof(req.points as unknown as PackedPoints);

  // Submit. The receipt index is the scope's live counter; retry once if a
  // concurrent verification took the slot.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const freshScope = attempt === 0 ? onChainScope : (await fetchScopeAccount(scopePk))!;
    const index = freshScope.verificationCount;
    const ix = verifyProofIx({
      payer: relayer.publicKey,
      group: groupPk,
      scope: scopePk,
      receiptIndex: index,
      root: root.bytes,
      nullifier: nullifier.bytes,
      message: message.bytes,
      proof: proofBytes,
    });
    try {
      const sent = await sendAndConfirm([ix], relayer, [], VERIFY_COMPUTE_UNITS);
      const [receipt] = receiptPda(scopePk, index);
      await query(
        `insert into verifications (receipt_pda, group_slug, scope_pda, receipt_index, root, nullifier, message, tx_signature, slot)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (receipt_pda) do nothing`,
        [receipt.toBase58(), groupRow.slug, req.scopePda, index.toString(), rootHex, bytesToHex(nullifier.bytes), bytesToHex(message.bytes), sent.signature, sent.slot],
      );
      return {
        signature: sent.signature,
        explorerUrl: explorerTxUrl(sent.signature),
        receiptPda: receipt.toBase58(),
        receiptIndex: Number(index),
        slot: sent.slot,
        root: rootHex,
        nullifier: bytesToHex(nullifier.bytes),
        message: bytesToHex(message.bytes),
        scopePda: req.scopePda,
        groupSlug: groupRow.slug,
      };
    } catch (e) {
      lastError = e;
      const text = e instanceof Error ? e.message : String(e);
      const described = describeProgramError(e);
      if (/NullifierAlreadyUsed/.test(described)) throw new HttpError(409, "nullifier already consumed in this one-time scope");
      if (/UnknownRoot|StaleRoot/.test(described)) throw new HttpError(409, `program rejected the root: ${described}`);
      if (/InvalidProof|MalformedProof|InvalidPublicInput/.test(described)) throw new HttpError(400, `program rejected the proof: ${described}`);
      // "already in use" => receipt index raced; loop once more with a fresh index.
      if (!/already in use|Custom\(0\)|0x0\b/.test(text)) break;
    }
  }
  throw new HttpError(502, `verify_proof transaction failed: ${describeProgramError(lastError)}`);
}

/** Lamports the relayer has left, for health reporting. */
export async function relayerStatus(): Promise<{ address: string; lamports: number; ok: boolean }> {
  const relayer = relayerKeypair();
  const lamports = await lamportsOf(relayer.publicKey);
  return { address: relayer.publicKey.toBase58(), lamports, ok: lamports >= RELAYER_MIN_LAMPORTS };
}

export { hexToBytes };
