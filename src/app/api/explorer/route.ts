import { explorerSnapshot } from "@/lib/server/explorer";
import { handle, json } from "@/lib/server/http";

export async function GET() {
  return handle(async () => json(await explorerSnapshot()));
}
