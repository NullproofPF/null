/**
 * Server-side configuration. Secrets are read lazily so that `next build` does
 * not need them, and nothing here is ever sent to the client.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "mainnet-beta") as "devnet" | "mainnet-beta" | "testnet" | "localnet";

export function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com";
}

export function publicRpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://solana-rpc.publicnode.com";
}

export function databaseUrl(): string {
  return required("DATABASE_URL");
}

export function adminToken(): string {
  return required("ADMIN_TOKEN");
}

/** Accepts a JSON byte array (solana-keygen format) or a base58 secret key. */
export function parseKeypair(raw: string, label: string): Keypair {
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith("[")) {
      const arr = JSON.parse(trimmed) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    }
    return Keypair.fromSecretKey(bs58.decode(trimmed));
  } catch {
    throw new Error(`${label} is not a valid keypair (expected JSON byte array or base58 secret key)`);
  }
}

let issuerCache: Keypair | undefined;
let relayerCache: Keypair | undefined;

/** Group administrator key: signs update_group_root / create_scope. Server only. */
export function issuerKeypair(): Keypair {
  issuerCache ??= parseKeypair(required("ISSUER_ADMIN_KEYPAIR"), "ISSUER_ADMIN_KEYPAIR");
  return issuerCache;
}

/** Fee payer for sponsored verify_proof transactions. Server only. */
export function relayerKeypair(): Keypair {
  relayerCache ??= parseKeypair(required("RELAYER_KEYPAIR"), "RELAYER_KEYPAIR");
  return relayerCache;
}

export function hasServerKeys(): { issuer: boolean; relayer: boolean } {
  return { issuer: Boolean(process.env.ISSUER_ADMIN_KEYPAIR), relayer: Boolean(process.env.RELAYER_KEYPAIR) };
}

/** Relayer abuse limits. */
export const RELAY_LIMIT_PER_HOUR = Number(process.env.RELAY_LIMIT_PER_HOUR ?? 20);
export const RELAY_GLOBAL_LIMIT_PER_MINUTE = Number(process.env.RELAY_GLOBAL_LIMIT_PER_MINUTE ?? 30);
/** Below this balance (lamports) the relayer refuses new work and health reports DEGRADED. */
export const RELAYER_MIN_LAMPORTS = Number(process.env.RELAYER_MIN_LAMPORTS ?? 20_000_000);

export function explorerTxUrl(signature: string): string {
  const suffix = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function explorerAddressUrl(address: string): string {
  const suffix = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}
