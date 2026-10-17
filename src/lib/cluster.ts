/** Human label for a Solana cluster id. Solana's main network is identified as "mainnet-beta" in RPC and explorer URLs; the product shows it as MAINNET. */
export function clusterLabel(cluster: string | undefined | null): string {
  const c = (cluster ?? "mainnet-beta").toLowerCase();
  if (c === "mainnet-beta" || c === "mainnet") return "MAINNET";
  return c.toUpperCase();
}
