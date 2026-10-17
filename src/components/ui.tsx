"use client";

import { useState, type ReactNode } from "react";

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="label">{label}</div>
      <div className="mono break-all text-[0.8rem] leading-6">{children}</div>
    </div>
  );
}

export function Hash({ value, short = false }: { value: string | null | undefined; short?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted-2">[NONE]</span>;
  const shown = short && value.length > 20 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
  return (
    <button
      type="button"
      title="copy"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 900);
        });
      }}
      className="mono break-all text-left text-foreground hover:text-phosphor"
    >
      {shown}
      {copied && <span className="ml-2 text-[0.65rem] text-phosphor">COPIED</span>}
    </button>
  );
}

export function Notice({ tone = "muted", children }: { tone?: "muted" | "danger" | "ok"; children: ReactNode }) {
  const color = tone === "danger" ? "border-danger text-danger" : tone === "ok" ? "border-phosphor text-phosphor" : "border-line text-muted";
  return <div className={`mono border px-4 py-3 text-[0.72rem] leading-6 tracking-[0.06em] ${color}`}>{children}</div>;
}

export function PageHeader({ title, kicker, children }: { title: string; kicker: string; children?: ReactNode }) {
  return (
    <div className="border-b border-line pb-8">
      <div className="label">{kicker}</div>
      <h1 className="wordmark mt-3 text-5xl sm:text-6xl">{title}</h1>
      {children && <div className="mt-5 max-w-2xl text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="mono text-phosphor underline-offset-4 hover:underline">
      {children}
    </a>
  );
}
