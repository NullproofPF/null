import { BN254_FIELD_MODULUS } from "./constants";
import {
  bigintToBytes32,
  concatBytes,
  isBaseFieldElement,
  isScalarFieldElement,
  parseBigint,
} from "./field";
import { semaphoreHash } from "./semaphore-hash";

/** Semaphore's packed Groth16 proof: 8 decimal strings. */
export type PackedPoints = readonly [string, string, string, string, string, string, string, string];

/**
 * Semaphore packs a snarkjs proof as
 *   [a.x, a.y, b.x.c1, b.x.c0, b.y.c1, b.y.c0, c.x, c.y]
 * which is already the EVM / Solana alt_bn128 coordinate order for G2
 * (imaginary part first). Each coordinate becomes a 32-byte big-endian word.
 *
 * groth16-solana evaluates
 *   e(A, B) * e(prepared_inputs, gamma) * e(C, delta) * e(alpha, beta) == 1
 * so A must be supplied NEGATED (y -> p - y). This function does that.
 *
 * Output layout (256 bytes): proof_a (64) | proof_b (128) | proof_c (64).
 */
export function semaphorePointsToSolanaProof(points: PackedPoints): Uint8Array {
  if (points.length !== 8) throw new RangeError("expected 8 packed points");
  const coords = points.map((p) => parseBigint(p));
  for (const [i, c] of coords.entries()) {
    if (!isBaseFieldElement(c)) throw new RangeError(`proof coordinate ${i} is not in the base field`);
  }
  const [ax, ay, bx1, bx0, by1, by0, cx, cy] = coords;
  const negAy = ay === 0n ? 0n : BN254_FIELD_MODULUS - ay;
  return concatBytes(
    bigintToBytes32(ax),
    bigintToBytes32(negAy),
    bigintToBytes32(bx1),
    bigintToBytes32(bx0),
    bigintToBytes32(by1),
    bigintToBytes32(by0),
    bigintToBytes32(cx),
    bigintToBytes32(cy),
  );
}

/** Split a 256-byte Solana proof into its three points (useful for tests / display). */
export function splitSolanaProof(proof: Uint8Array): { a: Uint8Array; b: Uint8Array; c: Uint8Array } {
  if (proof.length !== 256) throw new RangeError("proof must be 256 bytes");
  return { a: proof.slice(0, 64), b: proof.slice(64, 192), c: proof.slice(192, 256) };
}

export interface PublicInputsRaw {
  /** Merkle root of the group (LeanIMT root, decimal or bigint). */
  merkleTreeRoot: bigint | string;
  /** Poseidon(hash(scope), secret), decimal or bigint. */
  nullifier: bigint | string;
  /** Raw (un-hashed) message as passed to generateProof. */
  message: bigint | string;
  /** Raw (un-hashed) scope value as passed to generateProof. */
  scope: bigint | string;
}

/**
 * The four 32-byte big-endian public inputs in the order the Semaphore circuit
 * exposes them: [merkleTreeRoot, nullifier, hash(message), hash(scope)].
 * The program rebuilds the same array itself from the account state and the
 * instruction arguments; this helper exists for off-chain checks and tests.
 */
export function buildPublicInputs(raw: PublicInputsRaw): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const root = parseBigint(raw.merkleTreeRoot);
  const nullifier = parseBigint(raw.nullifier);
  const message = parseBigint(raw.message);
  const scope = parseBigint(raw.scope);
  for (const [name, v] of Object.entries({ root, nullifier, message, scope })) {
    if (!isScalarFieldElement(v)) throw new RangeError(`${name} is not a scalar field element`);
  }
  return [
    bigintToBytes32(root),
    bigintToBytes32(nullifier),
    bigintToBytes32(semaphoreHash(message)),
    bigintToBytes32(semaphoreHash(scope)),
  ];
}
