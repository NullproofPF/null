import { healthReport } from "@/lib/server/explorer";
import { handle, json } from "@/lib/server/http";

export async function GET() {
  return handle(async () => {
    const report = await healthReport();
    return json(report, { status: report.status === "OPERATIONAL" ? 200 : 503 });
  });
}
