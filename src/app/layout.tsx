import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ProjectFooter } from "@/components/ProjectFooter";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://nullproof.lol"),
  title: "NULL / Prove everything. Reveal nothing.",
  description: "A zero-knowledge identity protocol built on Solana. Semaphore v4 proofs verified on chain.",
};

const NAV = [
  { href: "/identity", label: "IDENTITY" },
  { href: "/credentials", label: "CREDENTIALS" },
  { href: "/verify", label: "VERIFY" },
  { href: "/explorer", label: "EXPLORER" },
  { href: "/protocol", label: "PROTOCOL" },
] as const;

const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col scanline">
        <header className="border-b border-line">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4">
            <Link href="/" className="wordmark text-xl">
              NULL
            </Link>
            <nav className="mono flex flex-wrap items-center gap-4 text-[0.68rem] tracking-[0.16em] text-muted sm:gap-6">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="transition-colors hover:text-foreground">
                  {n.label}
                </Link>
              ))}
              {GITHUB_URL ? (
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Source code on GitHub"
                  title="Source code on GitHub"
                  className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor" className="inline-block">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  GITHUB
                </a>
              ) : null}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <ProjectFooter />
      </body>
    </html>
  );
}
