# Threat model

NULL is cryptographic infrastructure, not a website with a privacy label. This document states what each party can
and cannot do, what the software enforces, and what remains open. Live on Solana mainnet-beta since 2026-10-17 as an
experiment; no audit has been performed and no production security claim is made. Nothing in NULL holds or moves funds.

## Parties

- **Member**: holds a Semaphore identity secret in the browser vault.
- **Issuer (group administrator)**: controls invitations, the member list and root publication. Holds the admin key.
- **Relayer**: pays verify_proof fees. Holds a funded Solana key, sees request metadata.
- **Program**: the on-chain verifier. Trusts nothing but its embedded verifying key and the Group/Scope accounts.
- **Observer**: anyone reading chain data, the explorer or network traffic.

## Guarantees the software enforces

1. Identity secrets are generated with `crypto.getRandomValues` (via `@semaphore-protocol/identity`) in the browser and encrypted with PBKDF2-SHA256 (600k iterations) + AES-256-GCM before touching storage. Only commitments are sent anywhere.
2. The enrollment API accepts a commitment and an invitation code. There is no field for a secret or a wallet.
3. Credentials are never derived from a Solana wallet. The prover's wallet never appears in the verify transaction (the relayer pays).
4. The program recomputes the public inputs from chain state. The scope value comes from the Scope PDA; the caller cannot supply it.
5. Roots must have been published by the group administrator (`has_one = admin`). Unknown roots fail with `UnknownRoot`; roots outside the validity window fail with `StaleRoot`.
6. All public inputs must be canonical scalar-field elements (`InvalidPublicInput`), checked before any pairing work.
7. The pairing check runs through Light Protocol's `groth16-solana` on the alt_bn128 syscalls with the Semaphore v4 depth-16 verifying key. Any failure is `InvalidProof`; the transaction reverts and no account is written.
8. One-time scopes: a `NullifierRecord` PDA keyed by (scope, nullifier) is created on first use; a second use fails with `NullifierAlreadyUsed`. Multi-use scopes count uses and are, by design, linkable per scope.
9. Receipts hold root, nullifier, message, slot, timestamp, index, version and tree depth. No commitment, no payer, no path.
10. The relayer verifies every proof off chain with the exact Semaphore verifying key before spending a lamport, previews the nullifier record, enforces hourly per-caller buckets keyed by `sha256(salt:day:ip)` and a global per-minute cap, purges buckets after two hours and refuses work below a minimum balance.
11. `STATUS: OPERATIONAL` requires live success of: database query, RPC slot, program executable account, relayer balance, issuer key presence, genesis group registration. Anything else is `DEGRADED`.

## Threats

### Compromised or malicious issuer

Capabilities: admit arbitrary commitments (dilutes what membership means), refuse enrollment, publish a root that drops a member (revocation), publish garbage roots (denial of service), front-run with its own members to shrink the effective anonymity set.

Cannot: learn any member's secret, generate a proof as a member, or tell which member produced a receipt (it only knows the set).

Mitigations in place: on-chain root history is public (Explorer shows every root with publish and supersede slots), so silent root swaps are visible; admin transfer exists so control can move to a multisig; the credential is explicitly documented as "approved by this issuer" and nothing more.

Open: independent issuers, multisig admin, member-visible append-only log of commitments.

### Malicious relayer

Capabilities: censor or delay submissions; log IP address, timing and proof data; submit the proof itself (harmless, the proof is already bound to message and scope); correlate a submission with a network identity.

Cannot: alter message or scope (the proof fails), learn the commitment, forge proofs, double-spend a nullifier.

Mitigations: anyone can pay for `verify_proof` from any wallet, the program does not care who the payer is; the relayer stores only hashed buckets, not addresses or proofs; rate limits are documented in `.env.example`.

Open: multiple relayers, Tor-friendly submission, proof submission through a wallet of the member's choosing in the UI.

### Replay and re-proof

Replaying the same transaction or generating a fresh proof for a different message in the same one-time scope both fail: the nullifier is `Poseidon(hash(scope), secret)` and does not depend on the message. Tested in LiteSVM, on devnet, on mainnet and in the browser.

### Scope confusion

A proof for scope B cannot be used in scope A: the program hashes A's stored scope value into the public inputs, so the pairing check fails (`InvalidProof`). A scope from another group fails earlier with `ScopeGroupMismatch`. Scope values are derived from `(program domain, group PDA, scope id)`, so two groups never share a scope value.

### Small anonymity sets

A proof hides the prover among the commitments in the root it references. With 2 members an observer has a 50 percent guess. The UI shows the live member count on the credentials and verify pages and warns below 3. No fictitious members are added; group size is whatever the issuer actually enrolled.

### Client storage compromise

The vault lives in `localStorage` encrypted under the user's passphrase. Threats: malware with disk access plus a weak passphrase (offline guessing, slowed by 600k PBKDF2 iterations), malicious browser extensions reading decrypted memory during a session, shoulder-surfing the explicit "reveal private key" flow. The backup file carries the same ciphertext. Losing both device and backup loses the credential permanently; the UI says so before creation.

### Enrollment-to-verification correlation

The issuer knows which commitment redeemed which invitation and when. The relayer and RPC know when a verification arrived and from which address. Chain data shows the slot of each receipt. With small groups and tight timing an adversary who controls issuer and relayer logs (or watches both) can link an enrollment to a verification without breaking the cryptography. Members should expect this today. Mitigations: wait between enrollment and first proof, use a VPN or Tor toward the relayer, prefer large groups. NULL does not claim perfect anonymity.

### Proof-system assumptions

Groth16 soundness relies on the Semaphore v4 trusted setup (see `docs/ARTIFACTS.md`). A compromised ceremony would allow forged proofs for any Semaphore v4 deployment, not only NULL. The verifying key embedded in the program was generated from the published key in `@semaphore-protocol/proof`; the generator script and the JSON hash are in the repository so anyone can reproduce `verifying_key.rs`.

### Program upgrade authority

The program is upgradeable by the deployer key (`7S8uGPtrJiLx2R9PLuX6AgZY2T8nNA7NLVJZAd55DWZN` on mainnet). A malicious upgrade could accept anything. Before anyone relies on NULL for something that matters: audit, then freeze or hand the authority to a multisig with a timelock.

## Root lifecycle

1. Enrollment appends a commitment at the next leaf index (serialized per group with an advisory lock). The member is `pending`.
2. `publish-root` rebuilds the LeanIMT over all enrolled commitments in leaf order and sends `update_group_root(new_root, member_count)`. Members covered by that root become `included`.
3. On chain, the previous root is marked superseded at the current slot. It verifies for another `root_validity_slots`; then `StaleRoot`.
4. The group remembers 8 roots. Older entries are overwritten and become `UnknownRoot`.
5. Removal: the issuer rebuilds the tree without the member (LeanIMT `removeMember`) and publishes. The member keeps proving power for the validity window of the old root. For immediate effect call `set_root_validity(0)` first.

## Fail-closed checklist

| Condition | Result |
|---|---|
| Proof bytes wrong length or points off-curve | `MalformedProof` / `InvalidProof`, no write |
| Root not published | `UnknownRoot` |
| Root superseded beyond window | `StaleRoot` |
| Public input not in the scalar field | `InvalidPublicInput` |
| Pairing check fails | `InvalidProof` |
| Nullifier seen before in a one-time scope | `NullifierAlreadyUsed` |
| Signer is not the admin | `Unauthorized` |
| Scope belongs to another group | `ScopeGroupMismatch` |
| Relayer cannot verify off chain | HTTP 400, no transaction |
| Relayer underfunded | HTTP 503, health `DEGRADED` |
