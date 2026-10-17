import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import { BN254_FIELD_MODULUS, BN254_SCALAR_MODULUS, MERKLE_TREE_DEPTH } from "@/lib/zk/constants";
import { bigintToBytes32, bytesToBigint, bytesToHex, hexToBytes, isScalarFieldElement, parseBigint } from "@/lib/zk/field";
import { deriveScopeValue, messageFromString, scopeIdFromLabel, semaphoreHash } from "@/lib/zk/semaphore-hash";
import { buildPublicInputs, semaphorePointsToSolanaProof, splitSolanaProof, type PackedPoints } from "@/lib/zk/solana-proof";
import {
  ACCOUNT_SIZES,
  decodeGroup,
  groupPda,
  instructionDiscriminator,
  nullifierRecordPda,
  receiptPda,
  scopePda,
  verifyProofIx,
} from "@/lib/solana/program";

interface Fixtures {
  programId: string;
  groupId: string;
  groupPda: string;
  root: string;
  scopes: Record<string, { scopeId: string; scopeValue: string; scopePda: string; oneTime: boolean }>;
  proofs: Record<string, { root: string; nullifier: string; message: string; scopeValue: string; proof: string; points: string[]; messageText: string; scope: string }>;
  hashVectors: { input: string; semaphoreHash: string }[];
}

const fx: Fixtures = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "program/tests/fixtures/semaphore-fixtures.json"), "utf8"),
);
const pid = new PublicKey(fx.programId);

describe("field encoding", () => {
  it("round-trips 32-byte big-endian values", () => {
    for (const v of [0n, 1n, 255n, 256n, BN254_SCALAR_MODULUS - 1n, (1n << 256n) - 1n]) {
      expect(bytesToBigint(bigintToBytes32(v))).toBe(v);
    }
  });
  it("rejects values that do not fit", () => {
    expect(() => bigintToBytes32(1n << 256n)).toThrow();
    expect(() => bigintToBytes32(-1n)).toThrow();
  });
  it("checks canonical scalar field membership", () => {
    expect(isScalarFieldElement(BN254_SCALAR_MODULUS - 1n)).toBe(true);
    expect(isScalarFieldElement(BN254_SCALAR_MODULUS)).toBe(false);
    expect(BN254_FIELD_MODULUS > BN254_SCALAR_MODULUS).toBe(true);
  });
  it("parses decimal and hex strings", () => {
    expect(parseBigint("255")).toBe(255n);
    expect(parseBigint("0xff")).toBe(255n);
    expect(() => parseBigint("zz")).toThrow();
    expect(bytesToHex(hexToBytes("00ff"))).toBe("00ff");
  });
});

describe("semaphore hashing (mirrors the Rust program)", () => {
  it("matches the fixture vectors", () => {
    for (const v of fx.hashVectors) {
      expect(bytesToHex(bigintToBytes32(semaphoreHash(bytesToBigint(hexToBytes(v.input)))))).toBe(v.semaphoreHash);
    }
  });
  it("derives the same scope values as the fixtures", () => {
    const group = new PublicKey(fx.groupPda);
    for (const s of Object.values(fx.scopes)) {
      const value = deriveScopeValue(group.toBytes(), hexToBytes(s.scopeId));
      expect(bytesToHex(bigintToBytes32(value))).toBe(s.scopeValue);
      expect(isScalarFieldElement(value)).toBe(true);
    }
  });
  it("scope ids and messages are deterministic", () => {
    expect(bytesToHex(scopeIdFromLabel("scope-a"))).toBe(fx.scopes.a.scopeId);
    expect(messageFromString("vote:yes")).toBe(messageFromString("vote:yes"));
    expect(messageFromString("vote:yes")).not.toBe(messageFromString("vote:no"));
    expect(bytesToHex(bigintToBytes32(messageFromString(fx.proofs.alice_scope_a.messageText)))).toBe(fx.proofs.alice_scope_a.message);
  });
});

describe("proof conversion", () => {
  it("produces the exact Solana byte layout the program verified", () => {
    for (const p of Object.values(fx.proofs)) {
      expect(bytesToHex(semaphorePointsToSolanaProof(p.points as unknown as PackedPoints))).toBe(p.proof);
    }
  });
  it("negates A (y -> p - y) and keeps G2 in (c1, c0) order", () => {
    const p = fx.proofs.alice_scope_a;
    const { a, b, c } = splitSolanaProof(hexToBytes(p.proof));
    expect(bytesToBigint(a.slice(0, 32))).toBe(BigInt(p.points[0]));
    expect(bytesToBigint(a.slice(32, 64))).toBe(BN254_FIELD_MODULUS - BigInt(p.points[1]));
    expect(bytesToBigint(b.slice(0, 32))).toBe(BigInt(p.points[2]));
    expect(bytesToBigint(b.slice(32, 64))).toBe(BigInt(p.points[3]));
    expect(bytesToBigint(c.slice(0, 32))).toBe(BigInt(p.points[6]));
  });
  it("builds public inputs in circuit order", () => {
    const p = fx.proofs.alice_scope_a;
    const inputs = buildPublicInputs({
      merkleTreeRoot: bytesToBigint(hexToBytes(p.root)),
      nullifier: bytesToBigint(hexToBytes(p.nullifier)),
      message: messageFromString(p.messageText),
      scope: bytesToBigint(hexToBytes(p.scopeValue)),
    });
    expect(bytesToHex(inputs[0])).toBe(p.root);
    expect(bytesToHex(inputs[1])).toBe(p.nullifier);
    expect(inputs[2]).toEqual(bigintToBytes32(semaphoreHash(messageFromString(p.messageText))));
    expect(inputs[3]).toEqual(bigintToBytes32(semaphoreHash(bytesToBigint(hexToBytes(p.scopeValue)))));
  });
  it("rejects coordinates outside the base field", () => {
    const bad = [...fx.proofs.alice_scope_a.points] as string[];
    bad[0] = BN254_FIELD_MODULUS.toString();
    expect(() => semaphorePointsToSolanaProof(bad as unknown as PackedPoints)).toThrow();
  });
});

describe("program client", () => {
  it("derives the same PDAs as the Rust tests", () => {
    expect(groupPda(hexToBytes(fx.groupId), pid)[0].toBase58()).toBe(fx.groupPda);
    const group = new PublicKey(fx.groupPda);
    for (const s of Object.values(fx.scopes)) {
      expect(scopePda(group, hexToBytes(s.scopeId), pid)[0].toBase58()).toBe(s.scopePda);
    }
  });
  it("uses Anchor discriminators", () => {
    expect(bytesToHex(instructionDiscriminator("verify_proof"))).toHaveLength(16);
    expect(instructionDiscriminator("verify_proof")).not.toEqual(instructionDiscriminator("create_scope"));
  });
  it("encodes verify_proof with the documented account order and data layout", () => {
    const p = fx.proofs.alice_scope_a;
    const scope = new PublicKey(fx.scopes.a.scopePda);
    const payer = PublicKey.unique();
    const ix = verifyProofIx({
      payer,
      group: new PublicKey(fx.groupPda),
      scope,
      receiptIndex: 0,
      root: hexToBytes(p.root),
      nullifier: hexToBytes(p.nullifier),
      message: hexToBytes(p.message),
      proof: hexToBytes(p.proof),
      pid,
    });
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      payer.toBase58(),
      fx.groupPda,
      fx.scopes.a.scopePda,
      nullifierRecordPda(scope, hexToBytes(p.nullifier), pid)[0].toBase58(),
      receiptPda(scope, 0, pid)[0].toBase58(),
      "11111111111111111111111111111111",
    ]);
    expect(ix.data.length).toBe(8 + 32 + 32 + 32 + 256);
    expect(bytesToHex(new Uint8Array(ix.data.subarray(8 + 96)))).toBe(p.proof);
  });
  it("decodes a Group account of the documented size", () => {
    const bytes = new Uint8Array(ACCOUNT_SIZES.Group);
    bytes.set(instructionDiscriminatorFor("account:Group"), 0);
    bytes[8 + 96 + 8 * 56 + 1 + 48] = MERKLE_TREE_DEPTH; // merkle_tree_depth
    const g = decodeGroup(bytes);
    expect(g.rootHistory).toHaveLength(8);
    expect(g.merkleTreeDepth).toBe(MERKLE_TREE_DEPTH);
  });
});

function instructionDiscriminatorFor(preimage: string): Uint8Array {
  // sha256(preimage)[..8], same construction as the program client.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sha256 } = require("@noble/hashes/sha2.js") as typeof import("@noble/hashes/sha2.js");
  return sha256(new TextEncoder().encode(preimage)).slice(0, 8);
}
