/**
 * Revoke members from a group: delete their registry rows and publish the rebuilt root.
 * Removal takes effect on chain once the old root leaves the validity window (see THREAT_MODEL.md).
 *
 *   npx tsx --env-file=.env.local scripts/ops/revoke-member.ts <group-slug> <leafIndex|commitment> [...more] --yes
 */
import { getPool, query } from "../../src/lib/server/db";
import { listMembers, publishRoot } from "../../src/lib/server/issuer";
import { explorerTxUrl } from "../../src/lib/server/env";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--yes");
  if (!process.argv.includes("--yes")) throw new Error("refusing without --yes");
  const [slug, ...targets] = args;
  if (!slug || targets.length === 0) throw new Error("usage: revoke-member.ts <group-slug> <leafIndex|commitment>... --yes");

  const members = await listMembers(slug);
  const victims = members.filter((m) => targets.includes(String(m.leaf_index)) || targets.includes(m.commitment));
  if (victims.length !== targets.length) throw new Error(`matched ${victims.length} of ${targets.length} targets`);

  for (const v of victims) {
    await query("delete from members where group_slug = $1 and leaf_index = $2", [slug, v.leaf_index]);
    console.log(`removed leaf ${v.leaf_index} (${v.commitment.slice(0, 12)}...)`);
  }
  const remaining = await listMembers(slug);
  if (remaining.length === 0) {
    console.log("no members left; the previous root stays current on chain until a member enrolls and a root is published");
    return;
  }
  const r = await publishRoot(slug);
  console.log(`published root ${r.root} for ${r.memberCount} members${r.signature ? ` ${explorerTxUrl(r.signature)}` : " (unchanged)"}`);
}

main()
  .then(() => getPool().end())
  .catch(async (e) => {
    console.error(e instanceof Error ? e.message : e);
    await getPool().end().catch(() => undefined);
    process.exit(1);
  });
