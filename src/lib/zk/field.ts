import { BN254_FIELD_MODULUS, BN254_SCALAR_MODULUS } from "./constants";

/** Big-endian 32-byte encoding of a non-negative bigint. Throws if it does not fit. */
export function bigintToBytes32(value: bigint): Uint8Array {
  if (value < 0n) throw new RangeError("negative value");
  if (value >> 256n !== 0n) throw new RangeError("value does not fit in 32 bytes");
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Big-endian bytes → bigint. */
export function bytesToBigint(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new RangeError("odd hex length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new RangeError("invalid hex");
    out[i] = byte;
  }
  return out;
}

/** Parse a decimal or 0x-hex numeric string into a bigint. */
export function parseBigint(value: string | bigint | number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed);
  if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed);
  throw new RangeError(`not a numeric string: ${value}`);
}

/** True when `value` is a canonical BN254 scalar-field element (0 <= v < r). */
export function isScalarFieldElement(value: bigint): boolean {
  return value >= 0n && value < BN254_SCALAR_MODULUS;
}

/** True when `value` is a canonical BN254 base-field element (0 <= v < p). */
export function isBaseFieldElement(value: bigint): boolean {
  return value >= 0n && value < BN254_FIELD_MODULUS;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
