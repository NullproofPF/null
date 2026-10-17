import { PublicKey } from "@solana/web3.js";
import { handle, json } from "@/lib/server/http";
import { buildTree, getGroupRow, listMembers, rootHex } from "@/lib/server/issuer";
import { fetchGroupAccount } from "@/lib/server/solana";
import { bytesToHex } from "@/lib/zk/field";

/**
 * Public commitments in leaf order. Clients rebuild the LeanIMT from this list
 * and must check the resulting root against the on-chain group root before
 * proving. Only members covered by a published root are returned as included.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const group = await getGroupRow(slug);
    const members = await listMembers(slug);
    const included = members.filter((m) => m.status === "included");
    const onChain = await fetchGroupAccount(new PublicKey(group.group_pda));
    const tree = included.length > 0 ? buildTree(included) : null;
    return json({
      slug,
      groupPda: group.group_pda,
      onChainRoot: onChain ? bytesToHex(onChain.currentRoot) : null,
      computedRoot: tree ? rootHex(tree) : null,
      consistent: tree && onChain ? rootHex(tree) === bytesToHex(onChain.currentRoot) : false,
      members: included.map((m) => ({ leafIndex: m.leaf_index, commitment: m.commitment })),
      pending: members.filter((m) => m.status === "pending").map((m) => ({ leafIndex: m.leaf_index, commitment: m.commitment })),
    });
  });
}
