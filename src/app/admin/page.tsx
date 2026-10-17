"use client";

import { useState } from "react";
import { ExternalLink, Field, Hash, Notice, PageHeader } from "@/components/ui";
import { api, GENESIS_SLUG } from "@/lib/client/api";

/**
 * Issuer console. Every action hits /api/admin/* with the bearer token typed
 * here (kept in component state only). Invitation codes are displayed once.
 */
export default function AdminPage() {
  const [token, setToken] = useState("");
  const [group, setGroup] = useState(GENESIS_SLUG);
  const [groupName, setGroupName] = useState("NULL GENESIS");
  const [count, setCount] = useState(5);
  const [label, setLabel] = useState("");
  const [scopeLabel, setScopeLabel] = useState("");
  const [oneTime, setOneTime] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [out, setOut] = useState<{ tone: "ok" | "danger" | "muted"; text: string; link?: string } | null>(null);

  const run = async (name: string, fn: () => Promise<{ text: string; link?: string }>) => {
    setBusy(name);
    setOut(null);
    try {
      const r = await fn();
      setOut({ tone: "ok", text: r.text, link: r.link });
    } catch (e) {
      setOut({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-14">
      <PageHeader kicker="ISSUER" title="ADMIN">
        Group administration for the NULL GENESIS issuer. The admin key never leaves the server; this console only
        authorizes server actions with a bearer token. Membership decisions made here are the trust root of the
        credential: the issuer vouches for commitments, nothing else.
      </PageHeader>

      <section className="panel mt-10 p-6">
        <div className="label">ADMIN TOKEN</div>
        <input className="input mt-3" type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} />
      </section>

      {out && (
        <div className="mt-6">
          <Notice tone={out.tone}>
            {out.text} {out.link && <ExternalLink href={out.link}>TX</ExternalLink>}
          </Notice>
        </div>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <section className="panel p-6">
          <div className="label">GROUP</div>
          <input className="input mt-3" placeholder="slug" value={group} onChange={(e) => setGroup(e.target.value)} />
          <input className="input mt-3" placeholder="display name" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
          <button
            className="btn mt-4 w-full"
            disabled={!token || busy !== null}
            onClick={() =>
              run("group", async () => {
                const g = await api<{ group_pda: string }>("/api/admin/groups", { method: "POST", token, body: JSON.stringify({ slug: group, name: groupName }) });
                return { text: `GROUP READY AT ${g.group_pda}` };
              })
            }
          >
            [ Create / Adopt Group ]
          </button>
          <p className="mono mt-3 text-[0.65rem] leading-5 text-muted-2">INITIALIZES THE ON-CHAIN GROUP PDA IF IT DOES NOT EXIST. IDEMPOTENT.</p>
        </section>

        <section className="panel p-6">
          <div className="label">PUBLISH ROOT</div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Rebuilds the Merkle tree over every enrolled commitment and sends update_group_root. Pending members become included.
          </p>
          <button
            className="btn mt-4 w-full"
            disabled={!token || busy !== null}
            onClick={() =>
              run("root", async () => {
                const r = await api<{ root: string; memberCount: number; signature: string | null; explorerUrl: string | null; unchanged: boolean }>(
                  "/api/admin/publish-root",
                  { method: "POST", token, body: JSON.stringify({ group }) },
                );
                return {
                  text: r.unchanged ? `ROOT UNCHANGED (${r.memberCount} MEMBERS): ${r.root}` : `ROOT PUBLISHED (${r.memberCount} MEMBERS): ${r.root}`,
                  link: r.explorerUrl ?? undefined,
                };
              })
            }
          >
            {busy === "root" ? "PUBLISHING" : "[ Publish Root To Solana ]"}
          </button>
        </section>

        <section className="panel p-6">
          <div className="label">INVITATIONS</div>
          <div className="mt-3 flex gap-3">
            <input className="input" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            <input className="input" placeholder="label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <button
            className="btn mt-4 w-full"
            disabled={!token || busy !== null}
            onClick={() =>
              run("inv", async () => {
                const r = await api<{ codes: string[] }>("/api/admin/invitations", { method: "POST", token, body: JSON.stringify({ group, count, label: label || undefined }) });
                setCodes(r.codes);
                return { text: `${r.codes.length} CODES MINTED. COPY THEM NOW; ONLY HASHES ARE STORED.` };
              })
            }
          >
            [ Mint Single-Use Codes ]
          </button>
          {codes.length > 0 && (
            <div className="mono mt-4 grid gap-1 text-[0.8rem]">
              {codes.map((c) => (
                <Hash key={c} value={c} />
              ))}
            </div>
          )}
        </section>

        <section className="panel p-6">
          <div className="label">SCOPES</div>
          <input className="input mt-3" placeholder="scope label, e.g. proposal-7" value={scopeLabel} onChange={(e) => setScopeLabel(e.target.value)} />
          <label className="mono mt-3 flex items-center gap-3 text-[0.72rem] text-muted">
            <input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} />
            ONE-TIME (EACH MEMBER MAY ACT ONCE)
          </label>
          <button
            className="btn mt-4 w-full"
            disabled={!token || busy !== null || !scopeLabel}
            onClick={() =>
              run("scope", async () => {
                const s = await api<{ scope_pda: string; scope_value: string }>("/api/admin/scopes", { method: "POST", token, body: JSON.stringify({ group, label: scopeLabel, oneTime }) });
                return { text: `SCOPE ${scopeLabel} AT ${s.scope_pda} (VALUE ${s.scope_value.slice(0, 16)}...)` };
              })
            }
          >
            [ Create Scope ]
          </button>
        </section>
      </div>

      <div className="mt-8">
        <Field label="NOTE">
          <span className="text-muted">
            Root publication costs rent-free lamports for the transaction only; new scopes and receipts are paid by the issuer and relayer keys.
          </span>
        </Field>
      </div>
    </div>
  );
}
