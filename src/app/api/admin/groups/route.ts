import { handle, json, readJson, requireAdmin } from "@/lib/server/http";
import { registerGroup } from "@/lib/server/issuer";

/** Admin: create a membership group (initializes the on-chain Group PDA). */
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(request);
    const body = await readJson<{ slug?: string; name?: string; rootValiditySlots?: number }>(request);
    if (!body.slug || !body.name) return json({ error: "slug and name required" }, { status: 400 });
    const group = await registerGroup({
      slug: body.slug,
      name: body.name,
      rootValiditySlots: body.rootValiditySlots !== undefined ? BigInt(body.rootValiditySlots) : undefined,
    });
    return json(group, { status: 201 });
  });
}
