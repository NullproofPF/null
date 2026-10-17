"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Field, Hash, Notice, PageHeader } from "@/components/ui";
import { api, getExplorer, type ExplorerSnapshot } from "@/lib/client/api";

interface ReceiptView {
  receiptPda: string;
  addressUrl: string;
  group: string;
  scope: string;
  index: number;
  root: string;
  nullifier: string;
  message: string;
  slot: number;
  unixTimestamp: number;
  version: number;
  merkleTreeDepth: number;
  signature: string | null;
  explorerUrl: string | null;
}

function ReceiptLookup() {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("receipt") ?? "");
  const [receipt, setReceipt] = useState<ReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = (pda: string) => {
    if (!pda) return;
    setError(null);
    api<ReceiptView>(`/api/receipts/${pda}`)
      .then(setReceipt)
      .catch((e) => {
        setReceipt(null);
        setError(e instanceof Error ? e.message : "lookup failed");
      });
  };

  useEffect(() => {
    const initial = params.get("receipt");
    if (!initial) return;
    let alive = true;
    api<ReceiptView>(`/api/receipts/${initial}`)
      .then((r) => alive && setReceipt(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "lookup failed"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="panel p-6">
      <div className="label">INSPECT A RECEIPT (READ DIRECTLY FROM CHAIN)</div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input className="input" placeholder="receipt account address" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn whitespace-nowrap" onClick={() => lookup(query.trim())}>
          [ Inspect ]
        </button>
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      {receipt && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="RECEIPT">
            <ExternalLink href={receipt.addressUrl}>{receipt.receiptPda}</ExternalLink>
          </Field>
          <Field label="TRANSACTION">{receipt.explorerUrl ? <ExternalLink href={receipt.explorerUrl}>{receipt.signature}</ExternalLink> : "unknown"}</Field>
          <Field label="GROUP / SCOPE">
            <Hash value={receipt.group} short /> / <Hash value={receipt.scope} short />
          </Field>
          <Field label="INDEX / SLOT / TIME">
            #{receipt.index} / {receipt.slot} / {new Date(receipt.unixTimestamp * 1000).toISOString()}
          </Field>
          <Field label="ROOT">
            <Hash value={receipt.root} />
          </Field>
          <Field label="NULLIFIER">
            <Hash value={receipt.nullifier} />
          </Field>
          <Field label="MESSAGE">
            <Hash value={receipt.message} />
          </Field>
          <Field label="PROTOCOL VERSION / DEPTH">
            v{receipt.version} / {receipt.merkleTreeDepth}
          </Field>
        </div>
      )}
    </section>
  );
}

export default function ExplorerPage() {
  const [snap, setSnap] = useState<ExplorerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      getExplorer()
        .then((s) => {
          setSnap(s);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "explorer unavailable"));
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-14">
      <PageHeader kicker="PUBLIC RECORD" title="PROOF EXPLORER">
        Real protocol activity, read from the Solana program and the relayer&apos;s records. Receipts contain a root, a
        nullifier and a message. They never contain, and cannot be associated with, a member&apos;s commitment.
      </PageHeader>

      {error && (
        <div className="mt-6">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {snap && (
        <>
          <section className="mt-10 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="COMPLETED VERIFICATIONS" value={snap.totalVerifications} />
            <Stat label="REGISTERED GROUPS" value={snap.groupCount} />
            <Stat label="PROTOCOL VERSION" value={snap.protocolVersion} />
            <Stat label="NETWORK" value={snap.cluster.toUpperCase()} />
          </section>

          <section className="panel mt-8 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="PROGRAM ID">
                <Hash value={snap.programId} />
              </Field>
              <Field label="PROOF SYSTEM / CIRCUIT">
                {snap.proofSystem} on {snap.curve}, {snap.circuit}
              </Field>
            </div>
          </section>

          {snap.groups.map((g) => (
            <section key={g.slug} className="panel mt-8 p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="label">GROUP / {g.name}</div>
                <div className="mono text-[0.68rem] text-muted">
                  {g.includedMembers} {g.includedMembers === 1 ? "member" : "members"} / {g.verificationCount} {g.verificationCount === 1 ? "verification" : "verifications"} / {g.rootUpdates} {g.rootUpdates === 1 ? "root update" : "root updates"}
                </div>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="GROUP PDA">
                  <Hash value={g.groupPda} />
                </Field>
                <Field label="ADMIN">
                  <Hash value={g.admin} />
                </Field>
                <Field label="CURRENT ROOT">
                  <Hash value={g.currentRoot && !/^0+$/.test(g.currentRoot) ? g.currentRoot : null} />
                </Field>
                <Field label="ROOT VALIDITY WINDOW">{g.rootValiditySlots} slots after supersession</Field>
              </div>
              {g.rootHistory.length > 0 && (
                <div className="mt-5">
                  <div className="label">ROOT HISTORY (ON CHAIN)</div>
                  <div className="mono mt-2 grid gap-1 text-[0.7rem]">
                    {g.rootHistory.map((r) => (
                      <div key={r.root + r.publishedSlot} className="flex flex-wrap justify-between gap-2 border-b border-line py-1">
                        <Hash value={r.root} short />
                        <span className="text-muted">
                          {r.memberCount} members / published slot {r.publishedSlot} / {r.supersededSlot === 0 ? <span className="text-phosphor">current</span> : `superseded slot ${r.supersededSlot}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-5">
                <div className="label">SCOPES</div>
                <div className="mono mt-2 grid gap-1 text-[0.7rem]">
                  {g.scopes.length === 0 && <span className="text-muted-2">[NONE]</span>}
                  {g.scopes.map((s) => (
                    <div key={s.scopePda} className="grid gap-1 border-b border-line py-2 sm:grid-cols-[1fr_2fr_auto]">
                      <span>
                        {s.label} <span className="text-muted">{s.oneTime ? "one-time" : "multi-use"}</span>
                      </span>
                      <Hash value={s.scopePda} />
                      <span className="text-muted">{s.verificationCount} verified</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}

          <section className="panel mt-8 p-6">
            <div className="label">RECENT VERIFICATIONS</div>
            {snap.recent.length === 0 && <p className="mono mt-4 text-[0.72rem] text-muted-2">NO VERIFICATIONS YET.</p>}
            <div className="mono mt-4 grid gap-3 text-[0.7rem]">
              {snap.recent.map((v) => (
                <div key={v.receiptPda} className="grid gap-1 border-b border-line pb-3 sm:grid-cols-2">
                  <div>
                    <span className="text-muted">RECEIPT </span>
                    <a href={`/explorer?receipt=${v.receiptPda}`} className="hover:text-phosphor">
                      {v.receiptPda}
                    </a>
                  </div>
                  <div>
                    <span className="text-muted">TX </span>
                    <ExternalLink href={v.explorerUrl}>{v.signature.slice(0, 20)}...</ExternalLink>
                  </div>
                  <div>
                    <span className="text-muted">SCOPE </span>
                    {v.scopeLabel || v.scopePda} <span className="text-muted">#{v.receiptIndex}</span>
                  </div>
                  <div>
                    <span className="text-muted">SLOT </span>
                    {v.slot ?? "?"} <span className="text-muted">{new Date(v.verifiedAt).toISOString()}</span>
                  </div>
                  <div className="break-all">
                    <span className="text-muted">NULLIFIER </span>
                    {v.nullifier}
                  </div>
                  <div className="break-all">
                    <span className="text-muted">MESSAGE </span>
                    {v.message}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="mt-8">
        <Suspense fallback={null}>
          <ReceiptLookup />
        </Suspense>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background p-6">
      <div className="label">{label}</div>
      <div className="mono tabular mt-2 text-3xl">{value}</div>
    </div>
  );
}
