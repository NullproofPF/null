# HTTP API

All responses are JSON with `cache-control: no-store`. Errors: `{ "error": string, "details"?: any }` with 4xx/5xx.

## Public

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/ping` | Liveness probe (process up, schema reachable). Always 200. |
| GET | `/api/health` | Dependency checks. 200 with `status: "OPERATIONAL"`, else 503 with `status: "DEGRADED"` and per-check detail. |
| GET | `/api/groups` | Registered groups with on-chain state (root, history, counters) and scopes. |
| GET | `/api/groups/{slug}` | One group, plus `publishedRoots` (issuer records with transactions). |
| GET | `/api/groups/{slug}/members` | Public commitments covered by the published root (`members`, in leaf order), `pending` commitments, `onChainRoot`, `computedRoot`, `consistent`. Clients rebuild the tree from `members`. |
| GET | `/api/groups/{slug}/membership?commitment=<decimal>` | `status`: `unknown`, `pending` or `included`, with `leafIndex`, `includedRoot`, `currentRoot`, `memberCount`. |
| POST | `/api/groups/{slug}/enroll` | Body `{ code, commitment }`. Redeems a single-use invitation. 201 `{ leafIndex, commitment, status: "pending", pendingMembers }`. 404 unknown code, 409 used code or duplicate commitment, 410 expired, 400 invalid commitment. |
| POST | `/api/relay` | Body `{ scopePda, merkleTreeDepth: 16, merkleTreeRoot, nullifier, message, points[8] }` (decimal strings as produced by `generateProof`). Verifies off chain, submits `verify_proof` paid by the relayer. 201 `{ signature, explorerUrl, receiptPda, receiptIndex, slot, root, nullifier, message, scopePda, groupSlug }`. 400 invalid proof, 409 root not published or nullifier consumed, 429 rate limit, 503 relayer underfunded. |
| GET | `/api/explorer` | Totals, program id, protocol version, circuit, groups with root history and scopes, 50 most recent verifications. Syncs receipts created outside the relayer. |
| GET | `/api/receipts/{pda}` | Decodes a Receipt account directly from chain and resolves its transaction. |

## Admin (`Authorization: Bearer <ADMIN_TOKEN>`)

| Method | Route | Body | Effect |
|---|---|---|---|
| POST | `/api/admin/groups` | `{ slug, name, rootValiditySlots? }` | `initialize_group` if the PDA does not exist; registers the group. Idempotent. |
| POST | `/api/admin/invitations` | `{ group?, count?, label?, expiresInHours? }` | Mints codes `NULL-XXXXX-XXXXX-XXXXX`; returns plaintext once, stores sha256. |
| POST | `/api/admin/publish-root` | `{ group? }` | Rebuilds the LeanIMT over all enrolled commitments, `update_group_root`, marks members included. |
| POST | `/api/admin/scopes` | `{ group?, label, oneTime? }` | `create_scope`; verifies the on-chain scope value equals the client derivation. |

`group` defaults to `null-genesis`.

## Program (for integrators)

Instruction data is Anchor-encoded (`sha256("global:<name>")[..8]` + Borsh args). Account orders and layouts are in
`src/lib/solana/program.ts`; PDAs:

- Group: `["group", group_id(32)]`
- Scope: `["scope", group, scope_id(32)]`
- NullifierRecord: `["nullifier", scope, nullifier(32)]`
- Receipt: `["receipt", scope, verification_index(u64 LE)]`

`verify_proof(root, nullifier, message, proof[256])` accounts: payer (signer, writable), group (writable), scope
(writable), nullifier_record (writable), receipt (writable), system_program. Budget about 130k CU; request 400k.
