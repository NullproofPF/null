# Security policy

NULL is experimental cryptographic infrastructure running on Solana mainnet-beta. It has **not** been audited. Nothing in
NULL holds or moves funds, but a verifier bug could let a non-member produce an accepted proof, and a client bug could
leak an identity secret. We want to hear about both.

## Reporting a vulnerability

- Preferred: open a private report through GitHub Security Advisories on this repository ("Report a vulnerability").
- Alternative: DM [@NullProofPF](https://x.com/NullProofPF) on X with a way to reach you; do not post details publicly.

Please include reproduction steps, the affected component (program, relayer, issuer, browser client) and, for proof-system
issues, the exact public inputs and proof bytes involved. You should hear back within 72 hours.

## In scope

- `program/` (the Anchor verifier): accepting an invalid proof, an unpublished or expired root, a replayed nullifier, a
  wrong scope or message binding; bypassing admin checks.
- `src/lib/zk`, `src/lib/client`: proof conversion mistakes, identity secret exposure, vault encryption weaknesses.
- `src/lib/server`: relayer or issuer logic that lets a nonmember enroll, replays a proof, or stores more data than
  `docs/THREAT_MODEL.md` says it stores.

## Out of scope

- Anonymity-set size, timing correlation between enrollment and verification, and RPC or relayer metadata. These are
  documented limitations in `docs/THREAT_MODEL.md`, not bugs.
- The Semaphore v4 circuit and its trusted setup (report upstream to PSE).
- Denial of service against the free public RPC endpoint the browser uses.

## Keys and upgrade authority

The program is upgradeable by `7S8uGPtrJiLx2R9PLuX6AgZY2T8nNA7NLVJZAd55DWZN`. Until an audit is done and the authority is
frozen or moved to a multisig, treat the deployed verifier as trusted software, not trustless infrastructure.
