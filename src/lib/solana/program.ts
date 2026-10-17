/**
 * Thin client for the NULL verifier program. No Anchor runtime dependency:
 * discriminators, Borsh layouts and PDAs are encoded by hand so the same code
 * runs in the browser, the relayer and the fixture generator.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "../zk/field";

export const DEFAULT_PROGRAM_ID = "EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS";

export function programId(): PublicKey {
  const fromEnv =
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_NULL_PROGRAM_ID) || undefined;
  return new PublicKey(fromEnv ?? DEFAULT_PROGRAM_ID);
}

export const ROOT_HISTORY_SIZE = 8;

const textEncoder = new TextEncoder();

/** Anchor instruction discriminator: sha256("global:<name>")[..8]. */
export function instructionDiscriminator(name: string): Uint8Array {
  return sha256(textEncoder.encode(`global:${name}`)).slice(0, 8);
}

/** Anchor account discriminator: sha256("account:<Name>")[..8]. */
export function accountDiscriminator(name: string): Uint8Array {
  return sha256(textEncoder.encode(`account:${name}`)).slice(0, 8);
}

export const ACCOUNT_DISCRIMINATORS = {
  Group: accountDiscriminator("Group"),
  Scope: accountDiscriminator("Scope"),
  NullifierRecord: accountDiscriminator("NullifierRecord"),
  Receipt: accountDiscriminator("Receipt"),
} as const;

function u64le(value: bigint | number): Uint8Array {
  const v = BigInt(value);
  if (v < 0n || v >> 64n !== 0n) throw new RangeError("u64 out of range");
  const out = new Uint8Array(8);
  let x = v;
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function expect32(bytes: Uint8Array, name: string): Uint8Array {
  if (bytes.length !== 32) throw new RangeError(`${name} must be 32 bytes`);
  return bytes;
}

// ---------------------------------------------------------------------------
// PDAs
// ---------------------------------------------------------------------------

export function groupPda(groupId: Uint8Array, pid = programId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([textEncoder.encode("group"), expect32(groupId, "groupId")], pid);
}

export function scopePda(group: PublicKey, scopeId: Uint8Array, pid = programId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("scope"), group.toBytes(), expect32(scopeId, "scopeId")],
    pid,
  );
}

export function nullifierRecordPda(scope: PublicKey, nullifier: Uint8Array, pid = programId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [textEncoder.encode("nullifier"), scope.toBytes(), expect32(nullifier, "nullifier")],
    pid,
  );
}

export function receiptPda(scope: PublicKey, index: bigint | number, pid = programId()): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([textEncoder.encode("receipt"), scope.toBytes(), u64le(index)], pid);
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

export function initializeGroupIx(args: {
  admin: PublicKey;
  groupId: Uint8Array;
  initialRoot: Uint8Array;
  rootValiditySlots: bigint | number;
  pid?: PublicKey;
}): TransactionInstruction {
  const pid = args.pid ?? programId();
  const [group] = groupPda(args.groupId, pid);
  const data = concatBytes(
    instructionDiscriminator("initialize_group"),
    expect32(args.groupId, "groupId"),
    expect32(args.initialRoot, "initialRoot"),
    u64le(args.rootValiditySlots),
  );
  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: args.admin, isSigner: true, isWritable: true },
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function updateGroupRootIx(args: {
  admin: PublicKey;
  group: PublicKey;
  newRoot: Uint8Array;
  memberCount: bigint | number;
  pid?: PublicKey;
}): TransactionInstruction {
  const data = concatBytes(
    instructionDiscriminator("update_group_root"),
    expect32(args.newRoot, "newRoot"),
    u64le(args.memberCount),
  );
  return new TransactionInstruction({
    programId: args.pid ?? programId(),
    keys: [
      { pubkey: args.admin, isSigner: true, isWritable: false },
      { pubkey: args.group, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

export function setRootValidityIx(args: {
  admin: PublicKey;
  group: PublicKey;
  rootValiditySlots: bigint | number;
  pid?: PublicKey;
}): TransactionInstruction {
  const data = concatBytes(instructionDiscriminator("set_root_validity"), u64le(args.rootValiditySlots));
  return new TransactionInstruction({
    programId: args.pid ?? programId(),
    keys: [
      { pubkey: args.admin, isSigner: true, isWritable: false },
      { pubkey: args.group, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

export function transferGroupAdminIx(args: {
  admin: PublicKey;
  group: PublicKey;
  newAdmin: PublicKey;
  pid?: PublicKey;
}): TransactionInstruction {
  const data = concatBytes(instructionDiscriminator("transfer_group_admin"), args.newAdmin.toBytes());
  return new TransactionInstruction({
    programId: args.pid ?? programId(),
    keys: [
      { pubkey: args.admin, isSigner: true, isWritable: false },
      { pubkey: args.group, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(data),
  });
}

export function createScopeIx(args: {
  admin: PublicKey;
  group: PublicKey;
  scopeId: Uint8Array;
  oneTime: boolean;
  pid?: PublicKey;
}): TransactionInstruction {
  const pid = args.pid ?? programId();
  const [scope] = scopePda(args.group, args.scopeId, pid);
  const data = concatBytes(
    instructionDiscriminator("create_scope"),
    expect32(args.scopeId, "scopeId"),
    new Uint8Array([args.oneTime ? 1 : 0]),
  );
  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: args.admin, isSigner: true, isWritable: true },
      { pubkey: args.group, isSigner: false, isWritable: true },
      { pubkey: scope, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

export function verifyProofIx(args: {
  payer: PublicKey;
  group: PublicKey;
  scope: PublicKey;
  /** Current `verification_count` of the scope; selects the receipt PDA. */
  receiptIndex: bigint | number;
  root: Uint8Array;
  nullifier: Uint8Array;
  message: Uint8Array;
  /** 256 bytes, Solana layout (A negated). */
  proof: Uint8Array;
  pid?: PublicKey;
}): TransactionInstruction {
  const pid = args.pid ?? programId();
  if (args.proof.length !== 256) throw new RangeError("proof must be 256 bytes");
  const [nullifierRecord] = nullifierRecordPda(args.scope, args.nullifier, pid);
  const [receipt] = receiptPda(args.scope, args.receiptIndex, pid);
  const data = concatBytes(
    instructionDiscriminator("verify_proof"),
    expect32(args.root, "root"),
    expect32(args.nullifier, "nullifier"),
    expect32(args.message, "message"),
    args.proof,
  );
  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.group, isSigner: false, isWritable: true },
      { pubkey: args.scope, isSigner: false, isWritable: true },
      { pubkey: nullifierRecord, isSigner: false, isWritable: true },
      { pubkey: receipt, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });
}

// ---------------------------------------------------------------------------
// Account decoding
// ---------------------------------------------------------------------------

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  take(n: number): Uint8Array {
    if (this.offset + n > this.bytes.length) throw new RangeError("account data too short");
    const out = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  u8(): number {
    return this.take(1)[0];
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u64(): bigint {
    const b = this.take(8);
    let v = 0n;
    for (let i = 7; i >= 0; i -= 1) v = (v << 8n) | BigInt(b[i]);
    return v;
  }
  i64(): bigint {
    const v = this.u64();
    return v >= 1n << 63n ? v - (1n << 64n) : v;
  }
  pubkey(): PublicKey {
    return new PublicKey(this.take(32));
  }
}

function checkDiscriminator(bytes: Uint8Array, expected: Uint8Array, name: string): Reader {
  const r = new Reader(bytes);
  const disc = r.take(8);
  for (let i = 0; i < 8; i += 1) {
    if (disc[i] !== expected[i]) throw new Error(`not a ${name} account`);
  }
  return r;
}

export interface RootEntry {
  root: Uint8Array;
  publishedSlot: bigint;
  supersededSlot: bigint;
  memberCount: bigint;
}

export interface GroupAccount {
  admin: PublicKey;
  groupId: Uint8Array;
  currentRoot: Uint8Array;
  rootHistory: RootEntry[];
  rootHistoryIndex: number;
  rootUpdates: bigint;
  memberCount: bigint;
  verificationCount: bigint;
  scopeCount: bigint;
  rootValiditySlots: bigint;
  createdAtSlot: bigint;
  merkleTreeDepth: number;
  bump: number;
}

export function decodeGroup(bytes: Uint8Array): GroupAccount {
  const r = checkDiscriminator(bytes, ACCOUNT_DISCRIMINATORS.Group, "Group");
  const admin = r.pubkey();
  const groupId = r.take(32);
  const currentRoot = r.take(32);
  const rootHistory: RootEntry[] = [];
  for (let i = 0; i < ROOT_HISTORY_SIZE; i += 1) {
    rootHistory.push({ root: r.take(32), publishedSlot: r.u64(), supersededSlot: r.u64(), memberCount: r.u64() });
  }
  return {
    admin,
    groupId,
    currentRoot,
    rootHistory,
    rootHistoryIndex: r.u8(),
    rootUpdates: r.u64(),
    memberCount: r.u64(),
    verificationCount: r.u64(),
    scopeCount: r.u64(),
    rootValiditySlots: r.u64(),
    createdAtSlot: r.u64(),
    merkleTreeDepth: r.u8(),
    bump: r.u8(),
  };
}

export interface ScopeAccount {
  group: PublicKey;
  scopeId: Uint8Array;
  scopeValue: Uint8Array;
  oneTime: boolean;
  verificationCount: bigint;
  createdAtSlot: bigint;
  bump: number;
}

export function decodeScope(bytes: Uint8Array): ScopeAccount {
  const r = checkDiscriminator(bytes, ACCOUNT_DISCRIMINATORS.Scope, "Scope");
  return {
    group: r.pubkey(),
    scopeId: r.take(32),
    scopeValue: r.take(32),
    oneTime: r.bool(),
    verificationCount: r.u64(),
    createdAtSlot: r.u64(),
    bump: r.u8(),
  };
}

export interface NullifierRecordAccount {
  scope: PublicKey;
  nullifier: Uint8Array;
  uses: bigint;
  firstSlot: bigint;
  bump: number;
}

export function decodeNullifierRecord(bytes: Uint8Array): NullifierRecordAccount {
  const r = checkDiscriminator(bytes, ACCOUNT_DISCRIMINATORS.NullifierRecord, "NullifierRecord");
  return { scope: r.pubkey(), nullifier: r.take(32), uses: r.u64(), firstSlot: r.u64(), bump: r.u8() };
}

export interface ReceiptAccount {
  group: PublicKey;
  scope: PublicKey;
  index: bigint;
  root: Uint8Array;
  nullifier: Uint8Array;
  message: Uint8Array;
  slot: bigint;
  unixTimestamp: bigint;
  version: number;
  merkleTreeDepth: number;
  bump: number;
}

export function decodeReceipt(bytes: Uint8Array): ReceiptAccount {
  const r = checkDiscriminator(bytes, ACCOUNT_DISCRIMINATORS.Receipt, "Receipt");
  return {
    group: r.pubkey(),
    scope: r.pubkey(),
    index: r.u64(),
    root: r.take(32),
    nullifier: r.take(32),
    message: r.take(32),
    slot: r.u64(),
    unixTimestamp: r.i64(),
    version: r.u8(),
    merkleTreeDepth: r.u8(),
    bump: r.u8(),
  };
}

/** Byte sizes (8-byte discriminator included) for getProgramAccounts filters. */
export const ACCOUNT_SIZES = {
  Group: 8 + 32 + 32 + 32 + ROOT_HISTORY_SIZE * 56 + 1 + 8 * 6 + 1 + 1,
  Scope: 8 + 32 + 32 + 32 + 1 + 8 + 8 + 1,
  NullifierRecord: 8 + 32 + 32 + 8 + 8 + 1,
  Receipt: 8 + 32 + 32 + 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1,
} as const;
