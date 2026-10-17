/**
 * Project information footer. Every link and the token address are optional
 * environment variables; nothing here is required to use the protocol.
 */
const CA = process.env.NEXT_PUBLIC_TOKEN_CA;
const CA_NOTE = process.env.NEXT_PUBLIC_TOKEN_NOTE;
const X_URL = process.env.NEXT_PUBLIC_X_URL;
import { clusterLabel } from "@/lib/cluster";
const LINKS = [
  { label: "PUMP.FUN", href: process.env.NEXT_PUBLIC_PUMP_URL },
  { label: "DOCS", href: process.env.NEXT_PUBLIC_DOCS_URL },
  { label: "GITHUB", href: process.env.NEXT_PUBLIC_GITHUB_URL },
].filter((l): l is { label: string; href: string } => Boolean(l.href));

/** The X logo as a plain monochrome glyph, sized to the footer's cap height. */
function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" fill="currentColor" className="inline-block align-[-1px]">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function ProjectFooter() {
  const programId = process.env.NEXT_PUBLIC_NULL_PROGRAM_ID ?? "EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS";
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "mainnet-beta";
  return (
    <footer className="border-t border-line">
      <div className="mono mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-6 text-[0.68rem] tracking-[0.12em] text-muted">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>NULL PROTOCOL / SOLANA {clusterLabel(cluster)}</span>
          <div className="flex items-center gap-5">
            {X_URL ? (
              <a
                href={X_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="NULL on X"
                title="Official X account"
                className="inline-flex items-center gap-1.5 hover:text-foreground"
              >
                <XGlyph />
                <span>{X_URL.replace(/^https?:\/\/(www\.)?x\.com\//, "@").replace(/\/$/, "")}</span>
              </a>
            ) : null}
            {LINKS.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="hover:text-foreground">
                {l.label}
              </a>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-1 break-all">
          <span>PROGRAM {programId}</span>
          {CA ? (
            <span>
              $NULL CA {CA}
              {CA_NOTE ? <span className="text-muted-2"> ({CA_NOTE})</span> : null}
            </span>
          ) : (
            <span className="text-muted-2">$NULL CA: NOT ANNOUNCED. THE TOKEN IS NOT REQUIRED TO USE NULL.</span>
          )}
        </div>
      </div>
    </footer>
  );
}
