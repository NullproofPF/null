import { PublicKey } from "@solana/web3.js";
import { handle, HttpError, json } from "@/lib/server/http";
import { fetchReceiptAccount, getConnection } from "@/lib/server/solana";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/server/env";
import { bytesToHex } from "@/lib/zk/field";

/** Anyone can inspect a verification receipt straight from chain state. */
export async function GET(_request: Request, { params }: { params: Promise<{ pda: string }> }) {
  return handle(async () => {
    const { pda } = await params;
    let pk: PublicKey;
    try {
      pk = new PublicKey(pda);
    } catch {
      throw new HttpError(400, "not a valid address");
    }
    const receipt = await fetchReceiptAccount(pk);
    if (!receipt) throw new HttpError(404, "no receipt at this address");
    const sigs = await getConnection().getSignaturesForAddress(pk, { limit: 1 }, "confirmed");
    const signature = sigs[0]?.signature ?? null;
    return json({
      receiptPda: pk.toBase58(),
      addressUrl: explorerAddressUrl(pk.toBase58()),
      group: receipt.group.toBase58(),
      scope: receipt.scope.toBase58(),
      index: Number(receipt.index),
      root: bytesToHex(receipt.root),
      nullifier: bytesToHex(receipt.nullifier),
      message: bytesToHex(receipt.message),
      slot: Number(receipt.slot),
      unixTimestamp: Number(receipt.unixTimestamp),
      version: receipt.version,
      merkleTreeDepth: receipt.merkleTreeDepth,
      signature,
      explorerUrl: signature ? explorerTxUrl(signature) : null,
    });
  });
}
