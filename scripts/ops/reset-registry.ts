/**
 * Export the issuer registry (all tables) to artifacts/registry-export-<cluster>-<timestamp>.json,
 * then truncate it. Used when the deployment moves to another cluster: group PDAs are the same on
 * every cluster (same program id and seeds), so rows from the old cluster must not be reused.
 *
 *   npx tsx --env-file=.env.local scripts/ops/reset-registry.ts --yes
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPool, query } from "../../src/lib/server/db";

const TABLES = ["verifications", "scopes", "roots", "members", "invitations", "groups", "relay_rate_limits"];

async function main() {
  if (!process.argv.includes("--yes")) throw new Error("refusing without --yes");
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) dump[t] = await query(`select * from ${t}`);
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "unknown";
  const out = path.resolve(process.cwd(), `artifacts/registry-export-${cluster}-${Date.now()}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dump, null, 2));
  for (const t of TABLES) await query(`truncate table ${t} cascade`);
  const counts = Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length]));
  console.log("exported", counts, "to", out);
  console.log("registry truncated");
}

main()
  .then(() => getPool().end())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await getPool().end().catch(() => undefined);
    process.exit(1);
  });
