"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  clearStored,
  createIdentity,
  currentSession,
  loadStored,
  lock as lockSession,
  restoreFromBackup,
  subscribe,
  unlock as unlockSession,
  vaultVersion,
  type EncryptedIdentity,
  type UnlockedIdentity,
} from "@/lib/identity/store";

export type IdentityState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "locked"; stored: EncryptedIdentity }
  | { kind: "unlocked"; stored: EncryptedIdentity; session: UnlockedIdentity };

const SERVER_SNAPSHOT = -1;

/** React view over the module-level identity vault (subscription based, SSR safe). */
export function useIdentity() {
  const version = useSyncExternalStore(subscribe, vaultVersion, () => SERVER_SNAPSHOT);

  const state = useMemo<IdentityState>(() => {
    if (version === SERVER_SNAPSHOT) return { kind: "loading" };
    const stored = loadStored();
    if (!stored) return { kind: "none" };
    const session = currentSession();
    if (session && session.commitment === stored.commitment) return { kind: "unlocked", stored, session };
    return { kind: "locked", stored };
  }, [version]);

  return {
    state,
    create: (passphrase: string) => createIdentity(passphrase),
    unlock: (passphrase: string) => unlockSession(passphrase),
    lock: () => lockSession(),
    restore: (blob: EncryptedIdentity, passphrase: string) => restoreFromBackup(blob, passphrase),
    wipe: () => clearStored(),
  };
}
