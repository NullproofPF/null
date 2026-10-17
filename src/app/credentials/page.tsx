"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/components/useIdentity";
import { ExternalLink, Field, Hash, Notice, PageHeader } from "@/components/ui";
import { enroll, GENESIS_SLUG, getGroup, getMembership, type GroupInfo, type MembershipStatus } from "@/lib/client/api";

export default function CredentialsPage() {
  const id = useIdentity();
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [membership, setMembership] = useState<MembershipStatus | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger" | "muted"; text: string } | null>(null);

  const stored = id.state.kind === "locked" || id.state.kind === "unlocked" ? id.state.stored : null;

  const load = useCallback(() => {
    getGroup(GENESIS_SLUG)
      .then((g) => {
        setGroup(g);
        setGroupError(null);
      })
      .catch((e) => setGroupError(e instanceof Error ? e.message : "group unavailable"));
    if (stored) getMembership(stored.commitment).then(setMembership).catch(() => setMembership(null));
  }, [stored]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const submit = async () => {
    if (!stored) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await enroll(code, stored.commitment);
      setMessage({
        tone: "ok",
        text: `COMMITMENT ACCEPTED AS LEAF ${res.leafIndex}. ${res.pendingMembers} MEMBER(S) AWAIT THE NEXT ROOT PUBLICATION BY THE ISSUER.`,
      });
      setCode("");
      load();
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-14">
      <PageHeader kicker="02 / AUTHORIZE" title="CREDENTIALS">
        An issuer adds public commitments to a Merkle tree and publishes the root to the Solana program. The issuer never
        receives a private key. Today there is one group, NULL GENESIS, and membership means exactly &quot;approved
        by the NULL GENESIS issuer&quot;. Nothing more is attested.
      </PageHeader>

      <section className="panel mt-10 p-6">
        <div className="label">GROUP</div>
        {groupError && (
          <div className="mt-4">
            <Notice tone="danger">{groupError}</Notice>
          </div>
        )}
        {group && (
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="GROUP NAME">{group.name}</Field>
            <Field label="ISSUING AUTHORITY (ADMIN)">
              <Hash value={group.admin} short />
            </Field>
            <Field label="GROUP COMMITMENT (PDA)">
              <Hash value={group.groupPda} />
            </Field>
            <Field label="AUTHORIZED MERKLE ROOT">
              <Hash value={group.currentRoot && !/^0+$/.test(group.currentRoot) ? group.currentRoot : null} />
            </Field>
            <Field label="REGISTERED COMMITMENTS">
              <span className="tabular">{group.includedMembers}</span>
              <span className="text-muted"> included / {group.pendingMembers} pending</span>
            </Field>
            <Field label="ROOT UPDATES / VERIFICATIONS">
              <span className="tabular">
                {group.rootUpdates} / {group.verificationCount}
              </span>
            </Field>
            <Field label="SUPERSEDED ROOT VALIDITY">
              <span className="tabular">{group.rootValiditySlots}</span> slots
            </Field>
            <Field label="SCOPES">
              {group.scopes.length === 0 ? <span className="text-muted-2">[NONE]</span> : group.scopes.map((s) => s.label).join(", ")}
            </Field>
          </div>
        )}
        {group && group.includedMembers < 3 && (
          <p className="mono mt-5 text-[0.68rem] leading-5 text-muted-2">
            ANONYMITY SET IS {group.includedMembers}. A PROOF FROM THIS GROUP IS ONLY AS ANONYMOUS AS THE NUMBER OF REAL MEMBERS.
          </p>
        )}
      </section>

      <section className="panel mt-8 p-6">
        <div className="label">ENROLLMENT</div>
        {!stored && (
          <p className="mt-4 text-sm text-muted">
            No identity on this device.{" "}
            <Link href="/identity" className="text-foreground underline underline-offset-4">
              Create one first.
            </Link>
          </p>
        )}
        {stored && (
          <div className="mt-4 grid gap-5">
            <Field label="YOUR PUBLIC COMMITMENT (THE ONLY THING SENT TO THE ISSUER)">
              <Hash value={stored.commitment} />
            </Field>
            <Field label="ENROLLMENT STATUS">
              {membership?.status === "included" && (
                <span className="text-phosphor">INCLUDED AS LEAF {membership.leafIndex} IN ROOT {membership.includedRoot?.slice(0, 16)}...</span>
              )}
              {membership?.status === "pending" && <span className="text-muted">PENDING: ENROLLED AS LEAF {membership.leafIndex}, WAITING FOR ROOT PUBLICATION</span>}
              {membership?.status === "unknown" && <span>NOT ENROLLED</span>}
              {!membership && <span className="text-muted">CHECKING</span>}
            </Field>
            {membership?.status === "unknown" && (
              <div className="flex flex-col gap-3 sm:flex-row">
                <input className="input" placeholder="NULL-XXXXX-XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} />
                <button className="btn whitespace-nowrap" disabled={busy || code.trim().length < 10} onClick={submit}>
                  {busy ? "SUBMITTING" : "[ Redeem Invitation ]"}
                </button>
              </div>
            )}
            {membership?.status === "included" && (
              <Link href="/verify" className="btn w-full sm:w-auto">
                [ Prove Membership ]
              </Link>
            )}
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
          </div>
        )}
      </section>

      {group?.publishedRoots && group.publishedRoots.length > 0 && (
        <section className="panel mt-8 p-6">
          <div className="label">PUBLISHED ROOTS</div>
          <div className="mono mt-4 grid gap-2 text-[0.72rem]">
            {group.publishedRoots.map((r) => (
              <div key={r.root + r.publishedAt} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-2">
                <Hash value={r.root} short />
                <span className="text-muted">{r.memberCount} members</span>
                {r.explorerUrl ? <ExternalLink href={r.explorerUrl}>TX</ExternalLink> : <span className="text-muted-2">unchanged</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
