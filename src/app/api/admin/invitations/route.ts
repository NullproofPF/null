import { handle, json, readJson, requireAdmin } from "@/lib/server/http";
import { createInvitations } from "@/lib/server/issuer";

/** Admin: mint single-use invitation codes. Plaintext is returned exactly once. */
export async function POST(request: Request) {
  return handle(async () => {
    requireAdmin(request);
    const body = await readJson<{ group?: string; count?: number; label?: string; expiresInHours?: number }>(request);
    const codes = await createInvitations(body.group ?? "null-genesis", body.count ?? 1, body.label, body.expiresInHours);
    return json({ group: body.group ?? "null-genesis", codes }, { status: 201 });
  });
}
