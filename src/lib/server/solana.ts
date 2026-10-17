/**
 * Server-side Solana helpers: connection, account reads, transaction sending.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { rpcUrl } from "./env";
import {
  decodeGroup,
  decodeReceipt,
  decodeScope,
  programId,
  type GroupAccount,
  type ReceiptAccount,
  type ScopeAccount,
} from "../solana/program";

let connection: Connection | undefined;

export function getConnection(): Connection {
  connection ??= new Connection(rpcUrl(), { commitment: "confirmed" });
  return connection;
}

export async function fetchGroupAccount(pubkey: PublicKey): Promise<GroupAccount | null> {
  const info = await getConnection().getAccountInfo(pubkey, "confirmed");
  if (!info) return null;
  return decodeGroup(new Uint8Array(info.data));
}

export async function fetchScopeAccount(pubkey: PublicKey): Promise<ScopeAccount | null> {
  const info = await getConnection().getAccountInfo(pubkey, "confirmed");
  if (!info) return null;
  return decodeScope(new Uint8Array(info.data));
}

export async function fetchReceiptAccount(pubkey: PublicKey): Promise<ReceiptAccount | null> {
  const info = await getConnection().getAccountInfo(pubkey, "confirmed");
  if (!info) return null;
  return decodeReceipt(new Uint8Array(info.data));
}

export async function programDeployed(): Promise<boolean> {
  const info = await getConnection().getAccountInfo(programId(), "confirmed");
  return Boolean(info?.executable);
}

export interface SentTransaction {
  signature: string;
  slot: number | null;
}

/**
 * Sign, send and confirm a transaction. Confirmation uses the blockhash's
 * last-valid-height so a dropped transaction surfaces as an error, never as
 * a silent "success".
 */
export async function sendAndConfirm(
  instructions: TransactionInstruction[],
  payer: Keypair,
  extraSigners: Keypair[] = [],
  computeUnits?: number,
): Promise<SentTransaction> {
  const conn = getConnection();
  const tx = new Transaction();
  if (computeUnits) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  for (const ix of instructions) tx.add(ix);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer, ...extraSigners);
  const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  const result = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) {
    throw new Error(`transaction ${signature} failed: ${JSON.stringify(result.value.err)}`);
  }
  const status = await conn.getSignatureStatuses([signature]);
  return { signature, slot: status.value[0]?.slot ?? null };
}

/**
 * Translate a simulation / execution error into the program's error name.
 * Anchor custom errors are 6000 + index in declaration order.
 */
export const PROGRAM_ERROR_NAMES: Record<number, string> = {
  6000: "Unauthorized",
  6001: "UnknownRoot",
  6002: "StaleRoot",
  6003: "NullifierAlreadyUsed",
  6004: "ScopeGroupMismatch",
  6005: "InvalidPublicInput",
  6006: "MalformedProof",
  6007: "InvalidProof",
  6008: "Overflow",
};

export function describeProgramError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const match = text.match(/Custom(?:\\?"?:\s*|\()(\d+)/);
  if (match) {
    const code = Number(match[1]);
    const name = PROGRAM_ERROR_NAMES[code];
    if (name) return `${name} (${code})`;
  }
  return text;
}

export async function lamportsOf(pubkey: PublicKey): Promise<number> {
  return getConnection().getBalance(pubkey, "confirmed");
}
