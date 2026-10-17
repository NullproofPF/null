import Link from "next/link";
import { LiveTerminal } from "@/components/LiveTerminal";

const STEPS = [
  { n: "01", title: "GENERATE", body: "Create a private cryptographic identity. The key is generated in your browser and never leaves it." },
  { n: "02", title: "AUTHORIZE", body: "Receive membership in a trusted credential group. The issuer only ever sees your public commitment." },
  { n: "03", title: "PROVE", body: "Verify membership without revealing the member. A Groth16 proof is checked by a Solana program." },
];

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col px-5">
      <section className="flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
        <h1 className="wordmark select-none text-[clamp(6rem,24vw,20rem)]">NULL</h1>
        <p className="mono mt-10 text-[clamp(1rem,2.6vw,1.6rem)] leading-snug tracking-[0.18em] text-foreground">
          PROVE EVERYTHING.
          <br />
          REVEAL NOTHING.
        </p>
        <p className="mono mt-8 max-w-xl text-[0.72rem] leading-relaxed tracking-[0.18em] text-muted">
          A ZERO-KNOWLEDGE IDENTITY PROTOCOL BUILT ON SOLANA.
        </p>
        <div className="mt-12 flex flex-col gap-4 sm:flex-row">
          <Link href="/identity" className="btn">
            [ Create Identity ]
          </Link>
          <Link href="/verify" className="btn btn-ghost">
            [ Verify Credential ]
          </Link>
        </div>
      </section>

      <section className="grid gap-px border border-line bg-line md:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.n} className="bg-background p-8">
            <div className="label">
              {s.n} / {s.title}
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="my-16 grid gap-10 md:grid-cols-[1.1fr_1fr]">
        <LiveTerminal />
        <div className="flex flex-col justify-center gap-6 text-sm leading-relaxed text-muted">
          <p>
            NULL lets a member of an authorized group prove they belong to it without revealing which member they are.
            The proof is a Semaphore v4 Groth16 proof over BN254, generated in the browser and verified by an
            on-chain program using Solana&apos;s alt_bn128 syscalls.
          </p>
          <p>
            The MVP credential means exactly one thing: &quot;approved member of NULL GENESIS&quot;. It does not prove unique
            humanity, legal identity, age, or anything the issuer did not check.
          </p>
          <p className="mono text-[0.7rem] tracking-[0.12em] text-muted-2">
            ANONYMITY SCALES WITH THE REAL SIZE OF THE GROUP. SMALL GROUPS ARE NOT ANONYMOUS. SEE /PROTOCOL FOR THE THREAT MODEL.
          </p>
        </div>
      </section>
    </div>
  );
}
