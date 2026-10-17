/**
 * Public protocol activity: aggregates chain state and the relayer's records.
 * Receipts created outside this relayer are picked up by `syncReceipts`, which
 * compares the on-chain verification counter with what we have recorded.
 */
import { PublicKey } from "@solana/web3.js";
import { query } from "./db";
import { CLUSTER, explorerTxUrl, hasServerKeys, publicRpcUrl } from "./env";
import { dbHealthy } from "./db";
import { listGroups, listScopes, type GroupRow, type ScopeRow } from "./issuer";
import { fetchGroupAccount, fetchReceiptAccount, fetchScopeAccount, getConnection, programDeployed } from "./solana";
import { relayerStatus } from "./relayer";
import { MERKLE_TREE_DEPTH, PROTOCOL_VERSION, SEMAPHORE_ARTIFACT_VERSION } from "../zk/constants";
import { bytesToHex } from "../zk/field";
import { programId, receiptPda } from "../solana/program";

export interface VerificationRow {
  receipt_pda: string;
  group_slug: string;
  scope_pda: string;
  receipt_index: string;
  root: string;
  nullifier: string;
  message: string;
  tx_signature: string;
  slot: string | null;
  verified_at: string;
}

async function syncScopeReceipts(scope: ScopeRow, groupSlug: string): Promise<number> {
  const scopePk = new PublicKey(scope.scope_pda);
  const onChain = await fetchScopeAccount(scopePk);
  if (!onChain) return 0;
  const have = await query<{ n: string }>("select count(*)::text as n from verifications where scope_pda = $1", [scope.scope_pda]);
  const recorded = Number(have[0].n);
  const total = Number(onChain.verificationCount);
  if (recorded >= total) return 0;
  const known = new Set(
    (await query<{ receipt_index: string }>("select receipt_index from verifications where scope_pda = $1", [scope.scope_pda])).map((r) => r.receipt_index),
  );
  let added = 0;
  for (let i = 0; i < total && added < 50; i += 1) {
    if (known.has(String(i))) continue;
    const [pda] = receiptPda(scopePk, i);
    const receipt = await fetchReceiptAccount(pda);
    if (!receipt) continue;
    const sigs = await getConnection().getSignaturesForAddress(pda, { limit: 1 }, "confirmed");
    const signature = sigs[0]?.signature ?? "unknown";
    await query(
      `insert into verifications (receipt_pda, group_slug, scope_pda, receipt_index, root, nullifier, message, tx_signature, slot)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (receipt_pda) do nothing`,
      [pda.toBase58(), groupSlug, scope.scope_pda, String(i), bytesToHex(receipt.root), bytesToHex(receipt.nullifier), bytesToHex(receipt.message), signature, receipt.slot.toString()],
    );
    added += 1;
  }
  return added;
}

export async function syncReceipts(): Promise<number> {
  let added = 0;
  for (const g of await listGroups()) {
    for (const s of await listScopes(g.slug)) {
      added += await syncScopeReceipts(s, g.slug).catch(() => 0);
    }
  }
  return added;
}

export interface ExplorerGroup {
  slug: string;
  name: string;
  groupPda: string;
  admin: string;
  currentRoot: string | null;
  memberCount: number;
  includedMembers: number;
  pendingMembers: number;
  rootUpdates: number;
  verificationCount: number;
  rootValiditySlots: number;
  rootHistory: { root: string; publishedSlot: number; supersededSlot: number; memberCount: number }[];
  scopes: {
    scopePda: string;
    label: string;
    scopeId: string;
    scopeValue: string;
    oneTime: boolean;
    verificationCount: number;
  }[];
}

export async function explorerGroup(g: GroupRow): Promise<ExplorerGroup> {
  const pk = new PublicKey(g.group_pda);
  const onChain = await fetchGroupAccount(pk);
  const scopes = await listScopes(g.slug);
  const scopeStates = await Promise.all(scopes.map((s) => fetchScopeAccount(new PublicKey(s.scope_pda))));
  const counts = await query<{ status: string; n: string }>(
    "select status, count(*)::text as n from members where group_slug = $1 group by status",
    [g.slug],
  );
  const included = Number(counts.find((c) => c.status === "included")?.n ?? 0);
  const pending = Number(counts.find((c) => c.status === "pending")?.n ?? 0);
  return {
    slug: g.slug,
    name: g.name,
    groupPda: g.group_pda,
    admin: g.admin_pubkey,
    currentRoot: onChain ? bytesToHex(onChain.currentRoot) : null,
    memberCount: onChain ? Number(onChain.memberCount) : 0,
    includedMembers: included,
    pendingMembers: pending,
    rootUpdates: onChain ? Number(onChain.rootUpdates) : 0,
    verificationCount: onChain ? Number(onChain.verificationCount) : 0,
    rootValiditySlots: onChain ? Number(onChain.rootValiditySlots) : 0,
    rootHistory: onChain
      ? onChain.rootHistory
          .filter((e) => e.publishedSlot !== 0n)
          .map((e) => ({
            root: bytesToHex(e.root),
            publishedSlot: Number(e.publishedSlot),
            supersededSlot: Number(e.supersededSlot),
            memberCount: Number(e.memberCount),
          }))
          .sort((a, b) => b.publishedSlot - a.publishedSlot)
      : [],
    scopes: scopes.map((s, i) => ({
      scopePda: s.scope_pda,
      label: s.label,
      scopeId: s.scope_id,
      scopeValue: s.scope_value,
      oneTime: s.one_time,
      verificationCount: scopeStates[i] ? Number(scopeStates[i]!.verificationCount) : 0,
    })),
  };
}

export async function explorerSnapshot() {
  await syncReceipts().catch(() => 0);
  const groups = await Promise.all((await listGroups()).map(explorerGroup));
  const recent = await query<VerificationRow>(
    "select * from verifications order by verified_at desc, receipt_index desc limit 50",
  );
  const totals = await query<{ n: string }>("select count(*)::text as n from verifications");
  return {
    programId: programId().toBase58(),
    cluster: CLUSTER,
    protocolVersion: PROTOCOL_VERSION,
    proofSystem: "groth16",
    curve: "bn254",
    circuit: `semaphore-v4 depth ${MERKLE_TREE_DEPTH} (artifacts ${SEMAPHORE_ARTIFACT_VERSION})`,
    totalVerifications: Math.max(Number(totals[0].n), groups.reduce((n, g) => n + g.verificationCount, 0)),
    groupCount: groups.length,
    groups,
    recent: recent.map((r) => ({
      receiptPda: r.receipt_pda,
      groupSlug: r.group_slug,
      scopePda: r.scope_pda,
      scopeLabel: groups.find((g) => g.slug === r.group_slug)?.scopes.find((s) => s.scopePda === r.scope_pda)?.label ?? "",
      receiptIndex: Number(r.receipt_index),
      root: r.root,
      nullifier: r.nullifier,
      message: r.message,
      signature: r.tx_signature,
      explorerUrl: explorerTxUrl(r.tx_signature),
      slot: r.slot ? Number(r.slot) : null,
      verifiedAt: r.verified_at,
    })),
  };
}

export interface HealthReport {
  status: "OPERATIONAL" | "DEGRADED";
  cluster: string;
  programId: string;
  protocolVersion: string;
  checks: Record<string, { ok: boolean; detail?: string }>;
  rpc: string;
  checkedAt: string;
}

/** OPERATIONAL only when every dependency actually answered. */
export async function healthReport(): Promise<HealthReport> {
  const checks: HealthReport["checks"] = {};
  const keys = hasServerKeys();

  const db = await dbHealthy();
  checks.database = { ok: db.ok, detail: db.ok ? "connected" : db.error };

  try {
    const slot = await getConnection().getSlot("confirmed");
    checks.rpc = { ok: true, detail: `slot ${slot}` };
  } catch (e) {
    checks.rpc = { ok: false, detail: e instanceof Error ? e.message.split("\n")[0] : "rpc error" };
  }

  try {
    const deployed = await programDeployed();
    checks.program = { ok: deployed, detail: deployed ? "executable account found" : "program not deployed on this cluster" };
  } catch (e) {
    checks.program = { ok: false, detail: e instanceof Error ? e.message.split("\n")[0] : "rpc error" };
  }

  if (keys.relayer) {
    try {
      const r = await relayerStatus();
      checks.relayer = { ok: r.ok, detail: `${(r.lamports / 1e9).toFixed(4)} SOL at ${r.address}` };
    } catch (e) {
      checks.relayer = { ok: false, detail: e instanceof Error ? e.message.split("\n")[0] : "relayer error" };
    }
  } else {
    checks.relayer = { ok: false, detail: "RELAYER_KEYPAIR not configured" };
  }
  checks.issuer = { ok: keys.issuer, detail: keys.issuer ? "configured" : "ISSUER_ADMIN_KEYPAIR not configured" };

  try {
    const groups = await listGroups();
    const genesis = groups.find((g) => g.slug === "null-genesis");
    checks.genesisGroup = genesis
      ? { ok: true, detail: `${genesis.name} at ${genesis.group_pda}` }
      : { ok: false, detail: "NULL GENESIS group not registered" };
  } catch {
    checks.genesisGroup = { ok: false, detail: "database unavailable" };
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return {
    status: allOk ? "OPERATIONAL" : "DEGRADED",
    cluster: CLUSTER,
    programId: programId().toBase58(),
    protocolVersion: PROTOCOL_VERSION,
    checks,
    rpc: publicRpcUrl(),
    checkedAt: new Date().toISOString(),
  };
}
