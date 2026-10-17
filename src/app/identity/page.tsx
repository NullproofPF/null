"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/components/useIdentity";
import { ExternalLink, Field, Hash, Notice, PageHeader } from "@/components/ui";
import { downloadBackup, revealPrivateKey, validatePassphrase, type EncryptedIdentity } from "@/lib/identity/store";
import { getMembership, type MembershipStatus } from "@/lib/client/api";

export default function IdentityPage() {
  const id = useIdentity();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membership, setMembership] = useState<MembershipStatus | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [restoreBlob, setRestoreBlob] = useState<EncryptedIdentity | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const stored = id.state.kind === "locked" || id.state.kind === "unlocked" ? id.state.stored : null;
  const commitment = stored?.commitment ?? null;

  useEffect(() => {
    if (!commitment) return;
    let alive = true;
    getMembership(commitment)
      .then((m) => alive && setMembership(m))
      .catch(() => alive && setMembership(null));
    return () => {
      alive = false;
    };
  }, [commitment]);
  const membershipShown = commitment ? membership : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    file.text().then((t) => {
      try {
        const blob = JSON.parse(t) as EncryptedIdentity;
        if (blob.format !== "null-identity-backup") throw new Error("Not a NULL identity backup.");
        setRestoreBlob(blob);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unreadable backup file.");
      }
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-14">
      <PageHeader kicker="01 / GENERATE" title="IDENTITY">
        A Semaphore v4 identity: a random private key, an EdDSA public key and a Poseidon commitment. Generated here with
        the browser&apos;s CSPRNG, encrypted with your passphrase, stored only on this device. Losing the key and its
        backup means losing access to any credential issued to this commitment. There is no recovery.
      </PageHeader>

      {error && (
        <div className="mt-6">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {id.state.kind === "loading" && <div className="mono mt-10 text-muted">LOADING VAULT<span className="cursor" /></div>}

      {id.state.kind === "none" && (
        <div className="mt-10 grid gap-10 md:grid-cols-2">
          <section className="panel p-6">
            <div className="label">CREATE IDENTITY</div>
            <p className="mt-3 text-sm text-muted">Choose a passphrase. It encrypts the private key at rest and protects the backup file.</p>
            <input className="input mt-5" type="password" placeholder="passphrase (min 8 chars)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            <input className="input mt-3" type="password" placeholder="confirm passphrase" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button
              className="btn mt-5 w-full"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const problem = validatePassphrase(passphrase);
                  if (problem) throw new Error(problem);
                  if (passphrase !== confirm) throw new Error("Passphrases do not match.");
                  await id.create(passphrase);
                  setPassphrase("");
                  setConfirm("");
                })
              }
            >
              {busy ? "GENERATING" : "[ Create Identity ]"}
            </button>
          </section>

          <section className="panel p-6">
            <div className="label">RESTORE FROM BACKUP</div>
            <p className="mt-3 text-sm text-muted">Load an encrypted backup file and the passphrase it was exported with.</p>
            <input ref={fileRef} type="file" accept="application/json" className="mono mt-5 block w-full text-[0.75rem] text-muted" onChange={(e) => onFile(e.target.files?.[0])} />
            {restoreBlob && (
              <div className="mt-3">
                <Field label="BACKUP COMMITMENT">
                  <Hash value={restoreBlob.commitment} short />
                </Field>
              </div>
            )}
            <input className="input mt-3" type="password" placeholder="backup passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            <button
              className="btn btn-ghost mt-5 w-full"
              disabled={busy || !restoreBlob}
              onClick={() =>
                run(async () => {
                  if (!restoreBlob) throw new Error("Select a backup file first.");
                  await id.restore(restoreBlob, passphrase);
                  setPassphrase("");
                  setRestoreBlob(null);
                })
              }
            >
              [ Restore Identity ]
            </button>
          </section>
        </div>
      )}

      {stored && (
        <div className="mt-10 grid gap-8">
          <section className="panel p-6">
            <div className="mono text-[0.78rem] leading-7 tracking-[0.08em]">
              <div className="text-phosphor">IDENTITY GENERATED</div>
              <div>
                <span className="text-muted">PRIVATE KEY: </span>
                {revealed ? <span className="break-all text-danger">{revealed}</span> : "[HIDDEN]"}
              </div>
              <div className="break-all">
                <span className="text-muted">IDENTITY COMMITMENT: </span>
                <Hash value={stored.commitment} />
              </div>
              <div>
                <span className="text-muted">STATUS: </span>
                {membershipShown === null && <span className="text-muted">CHECKING</span>}
                {membershipShown?.status === "unknown" && <span>UNREGISTERED</span>}
                {membershipShown?.status === "pending" && <span className="text-muted">ENROLLED, AWAITING ROOT PUBLICATION</span>}
                {membershipShown?.status === "included" && <span className="text-phosphor">AUTHORIZED MEMBER OF NULL GENESIS</span>}
              </div>
              <div>
                <span className="text-muted">VAULT: </span>
                {id.state.kind === "unlocked" ? "UNLOCKED FOR THIS SESSION" : "LOCKED"}
              </div>
              <div className="text-muted-2">CREATED {stored.createdAt}</div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              An identity is not a credential. It becomes an authorized group member only after an issuer adds its commitment
              to a group and publishes the new Merkle root.{" "}
              {membershipShown?.status === "unknown" && (
                <Link href="/credentials" className="text-foreground underline underline-offset-4">
                  Redeem an invitation
                </Link>
              )}
            </p>
          </section>

          <section className="grid gap-8 md:grid-cols-2">
            <div className="panel p-6">
              <div className="label">{id.state.kind === "unlocked" ? "SESSION" : "UNLOCK"}</div>
              {id.state.kind === "locked" && (
                <>
                  <input className="input mt-5" type="password" placeholder="passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  <button className="btn mt-4 w-full" disabled={busy} onClick={() => run(() => id.unlock(passphrase).then(() => setPassphrase("")))}>
                    [ Unlock ]
                  </button>
                </>
              )}
              {id.state.kind === "unlocked" && (
                <div className="mt-5 flex flex-col gap-3">
                  <button className="btn btn-ghost" onClick={() => downloadBackup(stored)}>
                    [ Export Encrypted Backup ]
                  </button>
                  <button className="btn btn-ghost" onClick={() => { id.lock(); setRevealed(null); setConfirmReveal(false); }}>
                    [ Lock Vault ]
                  </button>
                  {!revealed && !confirmReveal && (
                    <button className="btn btn-ghost" onClick={() => setConfirmReveal(true)}>
                      [ Reveal Private Key ]
                    </button>
                  )}
                  {confirmReveal && !revealed && (
                    <div className="border border-danger p-4">
                      <p className="text-xs text-danger">
                        Anyone with this key can prove as you and burn your one-time actions. Only reveal on a trusted screen.
                      </p>
                      <div className="mt-3 flex gap-3">
                        <button className="btn btn-danger flex-1" onClick={() => { if (id.state.kind === "unlocked") setRevealed(revealPrivateKey(id.state.session)); }}>
                          Show
                        </button>
                        <button className="btn btn-ghost flex-1" onClick={() => setConfirmReveal(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {revealed && (
                    <button className="btn btn-ghost" onClick={() => { setRevealed(null); setConfirmReveal(false); }}>
                      [ Hide Private Key ]
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="panel p-6">
              <div className="label">DANGER ZONE</div>
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Wiping removes the encrypted identity from this browser. Without a backup the credential bound to this
                commitment is gone for good.
              </p>
              <button
                className="btn btn-danger mt-5 w-full"
                onClick={() => {
                  if (window.confirm("Wipe the identity from this device? This cannot be undone without a backup.")) {
                    id.wipe();
                    setRevealed(null);
                    setMembership(null);
                  }
                }}
              >
                [ Wipe Identity From Device ]
              </button>
              <p className="mono mt-5 text-[0.65rem] leading-5 text-muted-2">
                ENCRYPTION: PBKDF2-SHA256 (600K) + AES-256-GCM VIA WEBCRYPTO. STORAGE: LOCALSTORAGE. SEE{" "}
                <ExternalLink href="/protocol">PROTOCOL</ExternalLink> FOR CLIENT STORAGE RISKS.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
