"use client";

import { useEffect, useState } from "react";
import { getHealth, type HealthReport } from "@/lib/client/api";
import { clusterLabel } from "@/lib/cluster";

/**
 * The landing-page terminal. STATUS reads OPERATIONAL only when /api/health
 * reports every dependency (database, RPC, deployed program, funded relayer,
 * issuer key, genesis group) healthy. Anything else is shown as DEGRADED with
 * the failing checks listed.
 */
export function LiveTerminal() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getHealth()
        .then((r) => alive && (setReport(r), setError(null)))
        .catch((e) => {
          // A 503 still carries the report body.
          if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 503) {
            return getHealthLenient().then((r) => alive && r && setReport(r));
          }
          if (alive) setError(e instanceof Error ? e.message : "health check failed");
        });
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const programId = report?.programId ?? process.env.NEXT_PUBLIC_NULL_PROGRAM_ID ?? "EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS";
  const cluster = clusterLabel(report?.cluster ?? process.env.NEXT_PUBLIC_SOLANA_CLUSTER);
  const status = report ? report.status : error ? "UNREACHABLE" : "CHECKING";
  const failing = report ? Object.entries(report.checks).filter(([, c]) => !c.ok) : [];

  return (
    <div className="panel mono p-6 text-[0.78rem] leading-7 tracking-[0.08em]">
      <div className="text-muted">NULL PROTOCOL</div>
      <div>
        <span className="text-muted">NETWORK: </span>SOLANA {cluster}
      </div>
      <div>
        <span className="text-muted">PROOF SYSTEM: </span>GROTH16
      </div>
      <div>
        <span className="text-muted">IDENTITY MODEL: </span>ZERO KNOWLEDGE
      </div>
      <div className="break-all">
        <span className="text-muted">VERIFIER: </span>
        {programId}
      </div>
      <div>
        <span className="text-muted">STATUS: </span>
        <span className={status === "OPERATIONAL" ? "text-phosphor" : status === "CHECKING" ? "text-muted" : "text-danger"}>
          {status}
        </span>
        {status === "CHECKING" && <span className="cursor" />}
      </div>
      {failing.length > 0 && (
        <div className="mt-3 border-t border-line pt-3 text-[0.7rem] leading-6 text-muted">
          {failing.map(([k, c]) => (
            <div key={k}>
              <span className="text-danger">x</span> {k.toUpperCase()}: {c.detail}
            </div>
          ))}
        </div>
      )}
      {report && (
        <div className="mt-3 text-[0.65rem] text-muted-2">LAST CHECK {new Date(report.checkedAt).toISOString()}</div>
      )}
      <div className="mt-2 text-muted">
        &gt;<span className="cursor" />
      </div>
    </div>
  );
}

async function getHealthLenient(): Promise<HealthReport | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return (await res.json()) as HealthReport;
  } catch {
    return null;
  }
}
