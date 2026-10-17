import { keccak_256 } from "@noble/hashes/sha3.js";
import { bigintToBytes32, bytesToBigint, concatBytes } from "./field";
import { SCOPE_DOMAIN } from "./constants";

/**
 * Semaphore v4 `hash()`:  keccak256(bigEndian32(value)) >> 8.
 *
 * Both `message` and `scope` go through this before entering the circuit, so the
 * Groth16 public signals are [merkleTreeRoot, nullifier, hash(message), hash(scope)].
 * The Solana program recomputes exactly this with the keccak syscall.
 * Reference: @semaphore-protocol/proof/src/hash.ts
 */
export function semaphoreHash(value: bigint): bigint {
  const digest = keccak_256(bigintToBytes32(value));
  return bytesToBigint(digest) >> 8n;
}

/**
 * Scope value the Solana program assigns to a (group, scope_id) pair:
 *   keccak256(SCOPE_DOMAIN || group_pubkey(32) || scope_id(32)) with the first
 *   byte zeroed so the value is always a canonical scalar-field element.
 *
 * The user never chooses the scope value directly, which is what makes
 * nullifiers unforgeable per scope: they cannot pick an "equivalent" scope.
 * Mirrors `derive_scope_value` in the Rust program.
 */
export function deriveScopeValue(groupPubkey: Uint8Array, scopeId: Uint8Array): bigint {
  if (groupPubkey.length !== 32) throw new RangeError("group pubkey must be 32 bytes");
  if (scopeId.length !== 32) throw new RangeError("scope id must be 32 bytes");
  const digest = keccak_256(
    concatBytes(new TextEncoder().encode(SCOPE_DOMAIN), groupPubkey, scopeId),
  );
  digest[0] = 0;
  return bytesToBigint(digest);
}

/**
 * 32-byte scope identifier from a human-readable label: keccak256(label).
 * Only used as the PDA seed; the circuit-facing value is `deriveScopeValue`.
 */
export function scopeIdFromLabel(label: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(label));
}

/** 32-byte group identifier from a human-readable label: keccak256(label). */
export function groupIdFromLabel(label: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(label));
}

/**
 * Encode an arbitrary action message (string or bytes) as a scalar-field element:
 * keccak256(bytes) >> 8. Returned as bigint; the program receives the 32-byte BE form.
 */
export function messageFromBytes(bytes: Uint8Array): bigint {
  return bytesToBigint(keccak_256(bytes)) >> 8n;
}

export function messageFromString(text: string): bigint {
  return messageFromBytes(new TextEncoder().encode(text));
}
