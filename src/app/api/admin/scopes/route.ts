import { handle, json, readJson, requireAdmin } from "@/lib/server/http";
import { createScope } from "@/lib/server/issuer";

/** Admin: create a verification scope (one-time or multi-use) under a group. */
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(request);
    const body = await readJson<{ group?: string; label?: string; oneTime?: boolean }>(request);
    if (!body.label) return json({ error: "label required" }, { status: 400 });
    const scope = await createScope(body.group ?? "null-genesis", body.label, body.oneTime ?? true);
    return json(scope, { status: 201 });
  });
}
