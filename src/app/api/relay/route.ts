import { clientAddress, handle, json, readJson } from "@/lib/server/http";
import { enforceRateLimits, parseRelayRequest, relayProof } from "@/lib/server/relayer";

/**
 * Sponsored submission of a membership proof. The body carries only public
 * data: scope, root, nullifier, message and the Groth16 points.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const req = parseRelayRequest(await readJson(request));
    await enforceRateLimits(clientAddress(request));
    const result = await relayProof(req);
    return json(result, { status: 201 });
  });
}
