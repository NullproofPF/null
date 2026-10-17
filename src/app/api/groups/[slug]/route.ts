import { explorerGroup } from "@/lib/server/explorer";
import { handle, json } from "@/lib/server/http";
import { getGroupRow } from "@/lib/server/issuer";
import { query } from "@/lib/server/db";
import { explorerTxUrl } from "@/lib/server/env";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const row = await getGroupRow(slug);
    const group = await explorerGroup(row);
    const roots = await query<{ root: string; member_count: number; tx_signature: string | null; slot: string | null; published_at: string }>(
      "select root, member_count, tx_signature, slot, published_at from roots where group_slug = $1 order by id desc limit 20",
      [slug],
    );
    return json({
      ...group,
      publishedRoots: roots.map((r) => ({
        root: r.root,
        memberCount: r.member_count,
        signature: r.tx_signature,
        explorerUrl: r.tx_signature ? explorerTxUrl(r.tx_signature) : null,
        slot: r.slot ? Number(r.slot) : null,
        publishedAt: r.published_at,
      })),
    });
  });
}
