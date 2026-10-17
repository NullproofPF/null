import { handle, HttpError, json } from "@/lib/server/http";
import { membershipStatus } from "@/lib/server/issuer";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const commitment = new URL(request.url).searchParams.get("commitment");
    if (!commitment) throw new HttpError(400, "commitment query parameter required");
    return json(await membershipStatus(slug, commitment));
  });
}
