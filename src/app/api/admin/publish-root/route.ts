import { handle, json, readJson, requireAdmin } from "@/lib/server/http";
import { publishRoot } from "@/lib/server/issuer";
import { explorerTxUrl } from "@/lib/server/env";

/** Admin: recompute the Merkle tree and publish its root on chain. */
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(request);
    const body = await readJson<{ group?: string }>(request);
    const result = await publishRoot(body.group ?? "null-genesis");
    return json({ ...result, explorerUrl: result.signature ? explorerTxUrl(result.signature) : null }, { status: 201 });
  });
}
