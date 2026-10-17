# Deployment

## 1. Solana program

Requirements: Rust, Agave CLI (`cargo-build-sbf`, `solana`), a funded deployer key on the target cluster.

```bash
npm run vk                      # verifying_key.rs from @semaphore-protocol/proof (depth 16)
npm run program:build           # program/target/deploy/null_verifier.so (about 183 KB)
npm run program:test            # LiteSVM suite must pass

solana program deploy program/target/deploy/null_verifier.so \
  --program-id <program-keypair.json> \
  --keypair <deployer.json> --upgrade-authority <deployer.json> \
  -u mainnet-beta --commitment confirmed --with-compute-unit-price 100000 --max-sign-attempts 30
solana program show <PROGRAM_ID> -u mainnet-beta
```

The program id is baked into `declare_id!` and `src/lib/solana/program.ts` (`DEFAULT_PROGRAM_ID`); a new keypair means
updating both, regenerating fixtures (`npm run fixtures`, PDAs depend on the program id) and rebuilding.

Rent for 183 KB is 0.93 SOL (same on every cluster). The CLI defaults `--max-len` to the binary size; pass a larger
value if you expect the program to grow on upgrade. A failed deploy leaves a buffer account; `solana program close
<buffer>` recovers its rent.

Current deployments of `EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS` (same program keypair on both clusters):

| Cluster | Upgrade authority | Deploy tx |
|---|---|---|
| mainnet-beta (live site) | `7S8uGPtrJiLx2R9PLuX6AgZY2T8nNA7NLVJZAd55DWZN` | `4qBcs5qF4LZUHb1t6ZcDFRB7BkUvR2P9ghXt4oUXqUdk8FvoiYxMexsvbCBQJVUtwTJXgjM2AqpaqMYan2DWyNw6` |
| devnet (test) | `FK8M3ZkDiLu6wQNZtc7cK2R23dYrB2SPuZfJrXveBtCZ` | `5GyvWZUKC5a9ZZHUycyic869ESYXEoDLHGCcdfpZDDfgrz8eKdJ6TeAjYakADjHENFXZHUkZZkpiVtdsiTQKAhC3` |

## 2. Keys

Three keys, kept outside the repository (the operator's secrets folder):

| Key | Role | Where it is used |
|---|---|---|
| program keypair | program id | deploy only |
| issuer / deployer (`mainnet-deployer.json`) | group admin, upgrade authority | `ISSUER_ADMIN_KEYPAIR` on the server |
| relayer (`relayer.json`) | fee payer for verify_proof | `RELAYER_KEYPAIR` on the server |

`node tools/write-env.mjs` writes `.env.local` for mainnet by default (`NULL_CLUSTER=devnet` for a test setup, which
uses `deployer.json` as issuer). `node tools/import-key.mjs <file> <name>` imports a base58/JSON/hex secret into the
secrets folder and deletes the source. Moving the live service between clusters: run
`npx tsx --env-file=.env.local scripts/ops/reset-registry.ts --yes` first (exports, then truncates the registry), because
group and scope PDAs have the same addresses on every cluster.

## 3. Backend and frontend (Railway)

The web app, issuer API and relayer are one Next.js service. Postgres is a Railway plugin.

```bash
railway init --name project-null --json
railway add --database postgres --json          # note the serviceId
node tools/railway-proxy.mjs <postgresServiceId> # TCP proxy; writes DATABASE_URL into .env.local
node tools/write-env.mjs                        # keys, ADMIN_TOKEN, RELAY_SALT, RPC, NEXT_PUBLIC_*
railway add --service web
node tools/railway-vars.mjs web                 # upsert every .env.local key on the service (secrets never on the CLI)
bash scripts/ops/wait-deploy.sh web up          # railway up + poll until SUCCESS
railway domain --service web                    # public hostname -> .domain.txt
curl https://<host>/api/health                  # expect "status":"OPERATIONAL"
```

`railway.json` builds with `npm ci --legacy-peer-deps && npm run build`, starts `node server.mjs` (binds `$PORT`), health
checks `/api/ping`. `.railwayignore` must exclude `.env*`, `node_modules`, `.next`, `program/target` and the root
`/artifacts` evidence folder (anchored, so `public/artifacts` ships). `NODE_OPTIONS=--dns-result-order=ipv6first` is set
because `postgres.railway.internal` is IPv6 only.

Schema: created on first request by `ensureSchema()` (`create table if not exists`). No migrations tool.

## 4. Bootstrap the issuer

```bash
node tools/admin-cli.mjs group null-genesis NULL GENESIS   # initialize_group on chain + registry row
node tools/admin-cli.mjs scope genesis-vote                # one-time scope
node tools/admin-cli.mjs scope genesis-access --multi      # multi-use scope
node tools/admin-cli.mjs invites 10 launch                 # single-use codes, shown once
node tools/admin-cli.mjs publish-root                      # after members enrolled
```

The same actions are available in the `/admin` page with the bearer token.

## 5. Verify a deployment

```bash
npm run demo:e2e                                            # devnet only: enrolls throwaway identities, refuses mainnet
node tools/qa-browser.mjs https://<host> <invitation-code>  # headless browser: identity -> enroll -> root -> prove (real SOL on mainnet)
curl https://<host>/api/explorer | head -c 800
```

Members enrolled by test runs on mainnet are operator identities; revoke them with
`npx tsx --env-file=.env.local scripts/ops/revoke-member.ts null-genesis <leaf> --yes` so the member count stays honest.

## 6. Environment variables

See `.env.example`. Server-only: `DATABASE_URL`, `SOLANA_RPC_URL`, `ISSUER_ADMIN_KEYPAIR`, `RELAYER_KEYPAIR`,
`ADMIN_TOKEN`, `RELAY_SALT`, `RELAY_LIMIT_PER_HOUR`, `RELAY_GLOBAL_LIMIT_PER_MINUTE`, `RELAYER_MIN_LAMPORTS`.
Public (inlined at build): `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_CLUSTER`, `NEXT_PUBLIC_NULL_PROGRAM_ID`,
`NEXT_PUBLIC_TOKEN_CA`, `NEXT_PUBLIC_PUMP_URL`, `NEXT_PUBLIC_X_URL`, `NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_GITHUB_URL`.

## 7. Operations

- Relayer balance appears in `/api/health`; below `RELAYER_MIN_LAMPORTS` the relayer returns 503 and STATUS turns `DEGRADED`.
- Each first-use verification costs the relayer about 0.0037 SOL in rent (receipt + nullifier record) plus fees; repeats in multi-use scopes about 0.0022 SOL.
- Receipts created by third parties (anyone can call `verify_proof`) are picked up by the explorer's chain sync.
- To revoke a member: rebuild without the commitment and publish; see `docs/THREAT_MODEL.md` for the validity window.

## 8. Before anyone relies on NULL for something that matters

Specialized audit of program, relayer and client; freeze or multisig the upgrade authority; relayer monitoring and
funding alerts; rate limits tuned; independent issuer governance. The protocol runs on mainnet as an experiment and the
UI says so on every page.

## Custom domain (nullproof.lol)

Railway domains: `railway domain nullproof.lol --service web` and `railway domain www.nullproof.lol --service web`.
Each hostname gets its own CNAME target and `_railway-verify` TXT record. The zone lives on Cloudflare; records
must be **DNS only (grey cloud)** or Railway cannot issue the certificate (symptom: HTTP 525).

| Type | Name | Value | Proxy |
|---|---|---|---|
| CNAME | `@` | `c5qi1lsl.up.railway.app` | DNS only |
| TXT | `_railway-verify` | `railway-verify=cd480b7f56fabed9fdde744f1069fa56d7de4c480fb1efb9c0e119981cc73c8e` | |
| CNAME | `www` | `1reoaf9q.up.railway.app` | DNS only |
| TXT | `_railway-verify.www` | `railway-verify=88b0cfa484dd03b90c1ad638b07d297a380437f9e37715913bbe781851f01846` | |

`worker/` holds a Cloudflare Worker bridge (`nullproof-bridge`) that proxies the hostname to the Railway origin while
the zone is still orange-clouded. It goes inert once the records above are in place; leave it deployed.
Status: `railway domain status <id> --service web --json` (fields are nested under `domain`).
