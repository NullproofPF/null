/**
 * Browser-only identity vault.
 *
 * The Semaphore private key is generated with the platform CSPRNG (via
 * @semaphore-protocol/identity), encrypted with a user passphrase
 * (PBKDF2-SHA256 600k iterations -> AES-256-GCM) and kept in localStorage.
 * The decrypted key lives only in this module's memory for the session.
 * Nothing here ever leaves the device; the backend sees commitments only.
 */
import { Identity } from "@semaphore-protocol/identity";

export const STORAGE_KEY = "null.identity.v1";
export const BACKUP_FORMAT = "null-identity-backup";
export const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;

export interface EncryptedIdentity {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64 (AES-GCM, includes tag)
  /** Public commitment, stored in clear so the UI can show status while locked. */
  commitment: string;
  createdAt: string;
}

export interface UnlockedIdentity {
  identity: Identity;
  commitment: string;
  createdAt: string;
}

let session: UnlockedIdentity | null = null;

// Tiny change notifier so React can subscribe (useSyncExternalStore) instead of
// polling the vault inside effects.
let version = 0;
const listeners = new Set<() => void>();
function notify(): void {
  version += 1;
  for (const l of listeners) l();
}
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function vaultVersion(): number {
  return version;
}

const te = new TextEncoder();
const td = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) throw new Error("WebCrypto is unavailable in this browser");
  return crypto.subtle;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", te.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function validatePassphrase(p: string): string | null {
  if (p.length < 8) return "Passphrase must be at least 8 characters.";
  return null;
}

export async function encryptIdentity(identity: Identity, passphrase: string, createdAt = new Date().toISOString()): Promise<EncryptedIdentity> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = te.encode(JSON.stringify({ privateKey: identity.export() }));
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
    commitment: identity.commitment.toString(),
    createdAt,
  };
}

export async function decryptIdentity(blob: EncryptedIdentity, passphrase: string): Promise<Identity> {
  if (blob.format !== BACKUP_FORMAT || blob.kdf !== "PBKDF2-SHA256") throw new Error("Unrecognized backup format.");
  const key = await deriveKey(passphrase, fromB64(blob.salt), blob.iterations);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) as BufferSource }, key, fromB64(blob.ciphertext) as BufferSource);
  } catch {
    throw new Error("Wrong passphrase or corrupted backup.");
  }
  const { privateKey } = JSON.parse(td.decode(plaintext)) as { privateKey: string };
  const identity = Identity.import(privateKey);
  if (identity.commitment.toString() !== blob.commitment) throw new Error("Backup commitment does not match the decrypted key.");
  return identity;
}

export function loadStored(): EncryptedIdentity | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EncryptedIdentity;
  } catch {
    return null;
  }
}

export function saveStored(blob: EncryptedIdentity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  notify();
}

export function clearStored(): void {
  localStorage.removeItem(STORAGE_KEY);
  session = null;
  notify();
}

/** Generate a fresh identity, encrypt it, persist it, and unlock the session. */
export async function createIdentity(passphrase: string): Promise<{ unlocked: UnlockedIdentity; blob: EncryptedIdentity }> {
  const identity = new Identity();
  const blob = await encryptIdentity(identity, passphrase);
  session = { identity, commitment: blob.commitment, createdAt: blob.createdAt };
  saveStored(blob);
  return { unlocked: session, blob };
}

export async function unlock(passphrase: string): Promise<UnlockedIdentity> {
  const blob = loadStored();
  if (!blob) throw new Error("No identity stored on this device.");
  const identity = await decryptIdentity(blob, passphrase);
  session = { identity, commitment: blob.commitment, createdAt: blob.createdAt };
  notify();
  return session;
}

export function lock(): void {
  session = null;
  notify();
}

export function currentSession(): UnlockedIdentity | null {
  return session;
}

/** Import a backup file (re-encrypted under the same passphrase it was exported with). */
export async function restoreFromBackup(blob: EncryptedIdentity, passphrase: string): Promise<UnlockedIdentity> {
  const identity = await decryptIdentity(blob, passphrase);
  session = { identity, commitment: blob.commitment, createdAt: blob.createdAt };
  saveStored(blob);
  return session;
}

export function backupFilename(commitment: string): string {
  return `null-identity-${commitment.slice(0, 8)}.json`;
}

export function downloadBackup(blob: EncryptedIdentity): void {
  const data = new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFilename(blob.commitment);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Only for the explicit "reveal" flow. Returns the base64 private key export. */
export function revealPrivateKey(unlocked: UnlockedIdentity): string {
  return unlocked.identity.export();
}
