import { explorerGroup } from "@/lib/server/explorer";
import { handle, json } from "@/lib/server/http";
import { listGroups } from "@/lib/server/issuer";

export async function GET() {
  return handle(async () => {
    const groups = await Promise.all((await listGroups()).map(explorerGroup));
    return json({ groups });
  });
}
