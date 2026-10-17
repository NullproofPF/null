import { dbHealthy } from "@/lib/server/db";
import { json } from "@/lib/server/http";

/** Cheap liveness probe for the platform health check: process up, schema reachable. */
export async function GET() {
  const db = await dbHealthy();
  return json({ ok: true, database: db.ok, time: new Date().toISOString() }, { status: 200 });
}
