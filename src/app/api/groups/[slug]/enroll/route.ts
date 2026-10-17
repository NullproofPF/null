import { handle, json, readJson } from "@/lib/server/http";
import { enroll } from "@/lib/server/issuer";

/** Redeem a single-use invitation with a PUBLIC identity commitment. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const body = await readJson<{ code?: string; commitment?: string }>(request);
    const result = await enroll(slug, body.code ?? "", body.commitment);
    return json(result, { status: 201 });
  });
}
