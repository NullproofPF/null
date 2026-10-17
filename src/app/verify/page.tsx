"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useIdentity } from "@/components/useIdentity";
import { ExternalLink, Field, Hash, Notice, PageHeader } from "@/components/ui";
import { GENESIS_SLUG, getGroup, type GroupInfo, type ScopeInfo } from "@/lib/client/api";
import { proveMembership, type ProveOutcome, type ProveStep, type StepEvent } from "@/lib/client/prove";

const ORDER: ProveStep[] = [
  "FETCHING GROUP",
  "RECONSTRUCTING MERKLE TREE",
  "GENERATING WITNESS",
  "GENERATING ZERO-KNOWLEDGE PROOF",
  "VALIDATING PROOF",
  "SUBMITTING TO SOLANA",
  "VERIFIED",
];

export default function VerifyPage() {
  const id = useIdentity();
  const [group, setGroup] = useState<GroupInfo | null>(null);
  const [scope, setScope] = useState<ScopeInfo | null>(null);
  const [messageText, setMessageText] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [steps, setSteps] = useState<Record<string, StepEvent>>({});
  const [outcome, setOutcome] = useState<ProveOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getGroup(GENESIS_SLUG)
      .then((g) => {
        setGroup(g);
        if (!scope && g.scopes.length > 0) setScope(g.scopes[0]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "group unavailable"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prove = async () => {
    if (id.state.kind !== "unlocked" || !scope) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setSteps({});
    try {
      const out = await proveMembership({
        identity: id.state.session.identity,
        groupSlug: GENESIS_SLUG,
        scope,
        messageText: messageText.trim() || `null:${scope.label}`,
        onStep: (e) => setSteps((s) => ({ ...s, [e.step]: e })),
      });
      setOutcome(out);
      getGroup(GENESIS_SLUG).then(setGroup).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stored = id.state.kind === "locked" || id.state.kind === "unlocked" ? id.state.stored : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-14">
      <PageHeader kicker="03 / PROVE" title="VERIFY">
        Generate a Groth16 membership proof in this browser and have the Solana program verify it. The transaction is
        paid by a relayer, so no wallet of yours appears on chain. The proof reveals the group root, a scope-bound
        nullifier and your message. It does not reveal which commitment is yours.
      </PageHeader>

      {error && (
        <div className="mt-6">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {!stored && id.state.kind !== "loading" && (
        <p className="mt-8 text-sm text-muted">
          No identity on this device.{" "}
          <Link href="/identity" className="text-foreground underline underline-offset-4">
            Create or restore one first.
          </Link>
        </p>
      )}

      {stored && (
        <div className="mt-10 grid gap-8 md:grid-cols-[1fr_1fr]">
          <section className="panel p-6">
            <div className="label">PARAMETERS</div>
            <div className="mt-4 grid gap-4">
              <Field label="GROUP">{group ? group.name : "..."}</Field>
              <div>
                <div className="label">SCOPE</div>
                <select
                  className="input mt-1"
                  value={scope?.scopePda ?? ""}
                  onChange={(e) => setScope(group?.scopes.find((s) => s.scopePda === e.target.value) ?? null)}
                >
                  {group?.scopes.map((s) => (
                    <option key={s.scopePda} value={s.scopePda}>
                      {s.label} {s.oneTime ? "(one-time)" : "(multi-use)"}
                    </option>
                  ))}
                  {group && group.scopes.length === 0 && <option value="">no scopes configured</option>}
                </select>
                {scope && (
                  <p className="mono mt-2 text-[0.65rem] leading-5 text-muted-2">
                    SCOPE PDA {scope.scopePda}
                    <br />
                    {scope.oneTime ? "ONE ACTION PER MEMBER. A SECOND PROOF IN THIS SCOPE IS REJECTED ON CHAIN." : "MULTI-USE. REPEAT PROOFS ARE COUNTED, AND LINKABLE BY NULLIFIER WITHIN THIS SCOPE."}
                  </p>
                )}
              </div>
              <div>
                <div className="label">MESSAGE (BOUND INTO THE PROOF)</div>
                <input className="input mt-1" placeholder={scope ? `null:${scope.label}` : "message"} value={messageText} onChange={(e) => setMessageText(e.target.value)} />
                <p className="mono mt-2 text-[0.65rem] leading-5 text-muted-2">KECCAK256(MESSAGE) &gt;&gt; 8 IS A PUBLIC INPUT. CHANGING IT INVALIDATES THE PROOF.</p>
              </div>
              {id.state.kind === "locked" && (
                <div>
                  <div className="label">UNLOCK IDENTITY</div>
                  <div className="mt-1 flex gap-3">
                    <input className="input" type="password" placeholder="passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                    <button className="btn whitespace-nowrap" onClick={() => id.unlock(passphrase).then(() => setPassphrase("")).catch((e) => setError(e.message))}>
                      Unlock
                    </button>
                  </div>
                </div>
              )}
              <button className="btn w-full" disabled={busy || id.state.kind !== "unlocked" || !scope} onClick={prove}>
                {busy ? "WORKING" : "[ Prove Membership ]"}
              </button>
            </div>
          </section>

          <section className="panel p-6">
            <div className="label">SEQUENCE</div>
            <div className="mono mt-4 grid gap-2 text-[0.78rem] leading-6 tracking-[0.06em]">
              {ORDER.map((name) => {
                const s = steps[name];
                const glyph = !s ? "  " : s.state === "running" ? "> " : s.state === "done" ? "ok" : "xx";
                const color = !s ? "text-muted-2" : s.state === "failed" ? "text-danger" : s.state === "done" ? (name === "VERIFIED" ? "text-phosphor" : "text-foreground") : "text-foreground";
                return (
                  <div key={name} className={color}>
                    <span className="text-muted">[{glyph}]</span> {name}
                    {s?.state === "running" && <span className="cursor" />}
                    {s?.detail && <div className="pl-7 text-[0.65rem] leading-5 text-muted">{s.detail}</div>}
                    {s?.finishedAt && s.state === "done" && name !== "VERIFIED" && (
                      <span className="pl-2 text-[0.65rem] text-muted-2">{s.finishedAt - s.startedAt} ms</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {outcome && (
        <section className="panel mt-8 border-phosphor p-6">
          <div className="label text-phosphor">VERIFICATION RECEIPT</div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="TRANSACTION">
              <ExternalLink href={outcome.relay.explorerUrl}>{outcome.relay.signature}</ExternalLink>
            </Field>
            <Field label="RECEIPT ACCOUNT (PDA)">
              <Link href={`/explorer?receipt=${outcome.relay.receiptPda}`} className="text-foreground hover:text-phosphor">
                {outcome.relay.receiptPda}
              </Link>
            </Field>
            <Field label="MERKLE ROOT">
              <Hash value={outcome.rootHex} />
            </Field>
            <Field label="NULLIFIER (SCOPE-BOUND)">
              <Hash value={outcome.nullifierHex} />
            </Field>
            <Field label="MESSAGE">
              <span className="text-muted">&quot;{outcome.messageText}&quot; = </span>
              <Hash value={outcome.messageHex} short />
            </Field>
            <Field label="SLOT / INDEX">
              <span className="tabular">
                {outcome.relay.slot ?? "?"} / #{outcome.relay.receiptIndex}
              </span>
            </Field>
            <Field label="ANONYMITY SET">
              <span className="tabular">{outcome.anonymitySetSize}</span>
              <span className="text-muted"> commitments in the published root</span>
            </Field>
            <Field label="PROOF TIME">
              <span className="tabular">{outcome.timings["GENERATING ZERO-KNOWLEDGE PROOF"] ?? "?"}</span> ms in browser
            </Field>
          </div>
          <p className="mono mt-5 text-[0.65rem] leading-5 text-muted-2">
            THE PROGRAM VERIFIED THE PAIRING EQUATION WITH ITS EMBEDDED SEMAPHORE V4 VERIFYING KEY. NOTHING ON CHAIN LINKS THIS
            RECEIPT TO YOUR COMMITMENT.
          </p>
        </section>
      )}
    </div>
  );
}
