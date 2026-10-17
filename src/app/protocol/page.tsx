import { ExternalLink, PageHeader } from "@/components/ui";
import { ARTIFACT_SHA256, MERKLE_TREE_DEPTH, PROTOCOL_VERSION, SEMAPHORE_ARTIFACT_VERSION, SEMAPHORE_PACKAGE_VERSION } from "@/lib/zk/constants";
import { clusterLabel } from "@/lib/cluster";

const PROGRAM_ID = process.env.NEXT_PUBLIC_NULL_PROGRAM_ID ?? "EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS";
const CLUSTER = clusterLabel(process.env.NEXT_PUBLIC_SOLANA_CLUSTER);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel mt-8 p-6">
      <div className="label">{title}</div>
      <div className="mt-4 grid gap-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function ProtocolPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-14">
      <PageHeader kicker="SPECIFICATION" title="PROTOCOL">
        What NULL verifies, what it does not, and how it can fail. Version {PROTOCOL_VERSION}. Live on Solana {CLUSTER}.
      </PageHeader>

      <Section title="CRYPTOGRAPHY">
        <p>
          Identities are Semaphore v4 identities: a 32-byte secret, an EdDSA (Baby Jubjub) public key and a Poseidon commitment.
          Groups are LeanIMT Merkle trees over commitments (Poseidon). Membership proofs are Groth16 proofs over BN254 for the
          audited Semaphore v4 circuit at depth {MERKLE_TREE_DEPTH} (up to 65,536 members).
        </p>
        <p className="mono text-[0.72rem] leading-6">
          PUBLIC SIGNALS: [merkleTreeRoot, nullifier, keccak256(message)&gt;&gt;8, keccak256(scope)&gt;&gt;8]
          <br />
          NULLIFIER: Poseidon(hash(scope), secret)
          <br />
          SCOPE VALUE: keccak256(&quot;null-protocol/scope/v1&quot; || group_pda || scope_id) with the top byte cleared, derived by the program
        </p>
        <p>
          Proving artifacts (wasm {ARTIFACT_SHA256.wasm.slice(0, 16)}..., zkey {ARTIFACT_SHA256.zkey.slice(0, 16)}...) are the
          Semaphore {SEMAPHORE_ARTIFACT_VERSION} release from PSE&apos;s snark-artifacts, self-hosted here. The on-chain verifying key is
          generated from @semaphore-protocol/proof@{SEMAPHORE_PACKAGE_VERSION} and embedded in the program. Trusted setup: the Semaphore
          v4 ceremony (phase 2 on the Perpetual Powers of Tau). Nothing cryptographic was written in-house; the program only
          re-encodes points for Solana&apos;s alt_bn128 syscalls and negates A as groth16-solana expects.
        </p>
      </Section>

      <Section title="ON-CHAIN VERIFIER">
        <p className="mono text-[0.72rem] leading-6 break-all">PROGRAM {PROGRAM_ID} (Anchor, Solana {CLUSTER})</p>
        <p>
          verify_proof rebuilds the public inputs from chain state (the scope value comes from the Scope account, never from the
          caller), rejects roots the administrator never published or that expired from the history window, rejects non-canonical
          field elements, runs the pairing check through Light Protocol&apos;s groth16-solana, enforces one nullifier per one-time
          scope, and writes a Receipt PDA holding root, nullifier, message, slot and timestamp. Every failure is a hard error:
          nothing is written on an invalid proof.
        </p>
        <p>
          Root handling: the group keeps a ring buffer of 8 roots. The current root always verifies; a superseded root verifies
          for root_validity_slots after replacement (about one hour for NULL GENESIS) so proofs built moments before a membership
          change still land. A removed member therefore keeps proving power for that window; set the window to 0 for immediate
          revocation at the cost of races.
        </p>
      </Section>

      <Section title="WHAT A PROOF MEANS">
        <p>
          &quot;The prover holds the secret of some commitment the NULL GENESIS issuer placed in the published root, and has not acted
          before in this one-time scope.&quot; It does not prove unique humanity, legal identity, age, residency or anything the issuer
          did not check. The NULL GENESIS issuer checks exactly one thing: possession of a valid single-use invitation.
        </p>
      </Section>

      <Section title="THREAT MODEL">
        <p>
          <b className="text-foreground">Compromised issuer.</b> The admin key controls membership and roots. It can admit fake
          members (diluting trust, not anonymity) or revoke by publishing a root without you. It cannot prove as you or deanonymize
          proofs: it never sees secrets. Mitigation path: multisig admin, transparency log of published roots (the Explorer shows
          on-chain root history), multiple independent issuers.
        </p>
        <p>
          <b className="text-foreground">Malicious relayer.</b> The relayer sees proof, root, nullifier, message and your IP
          address. It can censor or delay. It cannot alter the message or scope (the proof binds them) and cannot learn your
          commitment. Anyone can run their own relayer or pay the transaction from any wallet; the program does not care who pays.
        </p>
        <p>
          <b className="text-foreground">Replay.</b> Nullifier records are PDAs keyed by (scope, nullifier); a replayed or re-proven
          action in a one-time scope fails with NullifierAlreadyUsed. Multi-use scopes intentionally allow repeats and are linkable
          within the scope by nullifier.
        </p>
        <p>
          <b className="text-foreground">Small anonymity sets.</b> A proof is hidden among the members of the published root. With
          two members it is a coin flip. The UI shows the live set size and never pads groups with fictitious members.
        </p>
        <p>
          <b className="text-foreground">Client storage compromise.</b> The identity is encrypted at rest (PBKDF2-SHA256, 600k
          iterations, AES-256-GCM) in localStorage. Malware on the device, a weak passphrase, or a malicious browser extension can
          still extract it. Back up the encrypted file and keep the passphrase offline.
        </p>
        <p>
          <b className="text-foreground">Enrollment-to-verification correlation.</b> The issuer knows which commitment redeemed
          which invitation, and when. The relayer and RPC providers see when a proof is submitted and from which network address.
          Timing, IP metadata and tiny groups can correlate an enrollment with a verification even though the cryptography does not.
          Use Tor or a VPN, wait before proving, and prefer groups with many members. NULL does not claim perfect anonymity.
        </p>
      </Section>

      <Section title="PRIVACY RULES THE SOFTWARE ENFORCES">
        <ul className="list-disc space-y-1 pl-5">
          <li>Secrets are generated with the browser CSPRNG and never transmitted; the enrollment API accepts commitments only.</li>
          <li>The database stores commitments, invitation hashes and public receipts. No wallets, no secrets, no raw IPs.</li>
          <li>Credentials are never derived from a Solana wallet address.</li>
          <li>Proofs are verified cryptographically off chain (relayer) and on chain (program). Fail closed everywhere.</li>
          <li>Only the group administrator can change accepted roots; the program enforces it with has_one checks.</li>
          <li>STATUS reads OPERATIONAL only when database, RPC, deployed program, relayer funds and issuer key all pass live checks.</li>
        </ul>
      </Section>

      <Section title="ROADMAP">
        <p>
          Private age-eligibility attestations, anonymous governance, unlinkable application access, expiring or revocable
          credentials and third-party issuers all fit this architecture (new groups, new scopes, new issuers; some need additional
          circuits). They arrive as new groups and issuers are added.
        </p>
        <p className="mono text-[0.68rem] text-muted-2">
          SOURCE AND DEVELOPER DOCS: <ExternalLink href={process.env.NEXT_PUBLIC_GITHUB_URL || "/"}>REPOSITORY</ExternalLink>
        </p>
      </Section>
    </div>
  );
}
