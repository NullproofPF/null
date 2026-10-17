/** Typed fetch helpers for the NULL API (browser and scripts). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body && !headers["content-type"]) headers["content-type"] = "application/json";
  if (init?.token) headers.authorization = `Bearer ${init.token}`;
  const base = typeof window === "undefined" ? (process.env.NULL_API_BASE ?? "http://localhost:3000") : "";
  const res = await fetch(`${base}${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text };
  }
  if (!res.ok) {
    const err = (body as { error?: string; details?: unknown }) ?? {};
    throw new ApiError(res.status, err.error ?? `request failed (${res.status})`, err.details);
  }
  return body as T;
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

export interface ScopeInfo {
  scopePda: string;
  label: string;
  scopeId: string;
  scopeValue: string;
  oneTime: boolean;
  verificationCount: number;
}

export interface GroupInfo {
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
  scopes: ScopeInfo[];
  publishedRoots?: { root: string; memberCount: number; signature: string | null; explorerUrl: string | null; slot: number | null; publishedAt: string }[];
}

export interface MembersResponse {
  slug: string;
  groupPda: string;
  onChainRoot: string | null;
  computedRoot: string | null;
  consistent: boolean;
  members: { leafIndex: number; commitment: string }[];
  pending: { leafIndex: number; commitment: string }[];
}

export interface MembershipStatus {
  status: "unknown" | "pending" | "included";
  leafIndex: number | null;
  includedRoot: string | null;
  currentRoot: string;
  memberCount: number;
}

export interface RelayResult {
  signature: string;
  explorerUrl: string;
  receiptPda: string;
  receiptIndex: number;
  slot: number | null;
  root: string;
  nullifier: string;
  message: string;
  scopePda: string;
  groupSlug: string;
}

export interface ExplorerSnapshot {
  programId: string;
  cluster: string;
  protocolVersion: string;
  proofSystem: string;
  curve: string;
  circuit: string;
  totalVerifications: number;
  groupCount: number;
  groups: GroupInfo[];
  recent: {
    receiptPda: string;
    groupSlug: string;
    scopePda: string;
    scopeLabel: string;
    receiptIndex: number;
    root: string;
    nullifier: string;
    message: string;
    signature: string;
    explorerUrl: string;
    slot: number | null;
    verifiedAt: string;
  }[];
}

export const GENESIS_SLUG = "null-genesis";

export const getHealth = () => api<HealthReport>("/api/health");
export const getGroup = (slug = GENESIS_SLUG) => api<GroupInfo>(`/api/groups/${slug}`);
export const getMembers = (slug = GENESIS_SLUG) => api<MembersResponse>(`/api/groups/${slug}/members`);
export const getMembership = (commitment: string, slug = GENESIS_SLUG) =>
  api<MembershipStatus>(`/api/groups/${slug}/membership?commitment=${encodeURIComponent(commitment)}`);
export const enroll = (code: string, commitment: string, slug = GENESIS_SLUG) =>
  api<{ leafIndex: number; commitment: string; status: string; pendingMembers: number }>(`/api/groups/${slug}/enroll`, {
    method: "POST",
    body: JSON.stringify({ code, commitment }),
  });
export const relay = (body: {
  scopePda: string;
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  nullifier: string;
  message: string;
  points: string[];
}) => api<RelayResult>("/api/relay", { method: "POST", body: JSON.stringify(body) });
export const getExplorer = () => api<ExplorerSnapshot>("/api/explorer");
