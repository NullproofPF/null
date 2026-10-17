/**
 * Independent Groth16 check that parses the Solana byte layout exactly the way
 * the on-chain program and the alt_bn128 syscalls do, using @noble/curves bn254.
 *
 * It is a test oracle only (never used in production paths). If this accepts a
 * proof and the program rejects it, the problem is in the Rust side; if this
 * rejects it, the byte conversion is wrong.
 */
import { bn254 } from "@noble/curves/bn254.js";
import { bytesToBigint } from "../../src/lib/zk/field";
import type { SolanaVerifyingKey } from "./verifying-key";

type G1 = ReturnType<typeof bn254.G1.Point.fromAffine>;
type G2 = ReturnType<typeof bn254.G2.Point.fromAffine>;

export function parseG1(bytes: Uint8Array): G1 {
  if (bytes.length !== 64) throw new RangeError("G1 must be 64 bytes");
  const x = bytesToBigint(bytes.slice(0, 32));
  const y = bytesToBigint(bytes.slice(32, 64));
  if (x === 0n && y === 0n) return bn254.G1.Point.ZERO;
  const p = bn254.G1.Point.fromAffine({ x, y });
  p.assertValidity();
  return p;
}

export function parseG2(bytes: Uint8Array): G2 {
  if (bytes.length !== 128) throw new RangeError("G2 must be 128 bytes");
  const Fp2 = bn254.fields.Fp2;
  const xc1 = bytesToBigint(bytes.slice(0, 32));
  const xc0 = bytesToBigint(bytes.slice(32, 64));
  const yc1 = bytesToBigint(bytes.slice(64, 96));
  const yc0 = bytesToBigint(bytes.slice(96, 128));
  const p = bn254.G2.Point.fromAffine({
    x: Fp2.create({ c0: xc0, c1: xc1 }),
    y: Fp2.create({ c0: yc0, c1: yc1 }),
  });
  p.assertValidity();
  return p;
}

/**
 * Returns true when e(A_neg, B) * e(inputs, gamma) * e(C, delta) * e(alpha, beta) == 1,
 * i.e. exactly the product the Solana pairing syscall evaluates in groth16-solana.
 */
export function solanaStyleGroth16Check(
  proof: Uint8Array,
  publicInputs: Uint8Array[],
  vk: SolanaVerifyingKey,
): boolean {
  if (proof.length !== 256) throw new RangeError("proof must be 256 bytes");
  if (publicInputs.length + 1 !== vk.ic.length) throw new RangeError("public input count mismatch");

  const aNeg = parseG1(proof.slice(0, 64));
  const b = parseG2(proof.slice(64, 192));
  const c = parseG1(proof.slice(192, 256));

  let prepared = parseG1(vk.ic[0]);
  publicInputs.forEach((input, i) => {
    const scalar = bytesToBigint(input);
    if (scalar >= bn254.fields.Fr.ORDER) throw new RangeError(`public input ${i} not in scalar field`);
    const term = scalar === 0n ? bn254.G1.Point.ZERO : parseG1(vk.ic[i + 1]).multiply(scalar);
    prepared = prepared.add(term);
  });

  const result = bn254.pairingBatch([
    { g1: aNeg, g2: b },
    { g1: prepared, g2: parseG2(vk.gammaG2) },
    { g1: c, g2: parseG2(vk.deltaG2) },
    { g1: parseG1(vk.alphaG1), g2: parseG2(vk.betaG2) },
  ]);
  return bn254.fields.Fp12.eql(result, bn254.fields.Fp12.ONE);
}
