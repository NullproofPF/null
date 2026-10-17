/**
 * Membership issuer: groups, single-use invitations, commitment enrollment and
 * Merkle root publication. The issuer only ever handles PUBLIC commitments.
 */
import { createHash, randomBytes } from "node:crypto";
import { Group } from "@semaphore-protocol/group";
import { PublicKey } from "@solana/web3.js";
import { HttpError } from "./http";
import { query, withTransaction } from "./db";
import { issuerKeypair } from "./env";
import { fetchGroupAccount, fetchScopeAccount, sendAndConfirm, describeProgramError } from "./solana";
import { bigintToBytes32, bytesToHex, hexToBytes, isScalarFieldElement, parseBigint } from "../zk/field";
import { deriveScopeValue, groupIdFromLabel, scopeIdFromLabel } from "../zk/semaphore-hash";
import { createScopeIx, groupPda, initializeGroupIx, scopePda, updateGroupRootIx } from "../solana/program";

/** ~1 hour of slots: how long a superseded root keeps verifying. */
export const DEFAULT_ROOT_VALIDITY_SLOTS = 9_000n;

export interface GroupRow {
  slug: string;
  name: string;
  group_id: string;
  group_pda: string;
  admin_pubkey: string;
  created_at: string;
}

export interface MemberRow {
  leaf_index: number;
  commitment: string;
  status: "pending" | "included";
  included_root: string | null;
  created_at: string;
  included_at: string | null;
}

export interface ScopeRow {
  scope_pda: string;
  group_slug: string;
  label: string;
  scope_id: string;
  scope_value: string;
  one_time: boolean;
  tx_signature: string | null;
  created_at: string;
}

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

export function validateCommitment(raw: unknown): bigint {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 80) throw new HttpError(400, "commitment must be a decimal string");
  let value: bigint;
  try {
    value = parseBigint(raw);
  } catch {
    throw new HttpError(400, "commitment must be a decimal or 0x-hex string");
  }
  if (value === 0n || !isScalarFieldElement(value)) throw new HttpError(400, "commitment is not a valid field element");
  return value;
}

export async function getGroupRow(slug: string): Promise<GroupRow> {
  const rows = await query<GroupRow>("select * from groups where slug = $1", [slug]);
  if (rows.length === 0) throw new HttpError(404, `group '${slug}' not found`);
  return rows[0];
}

export async function listGroups(): Promise<GroupRow[]> {
  return query<GroupRow>("select * from groups order by created_at asc");
}

export async function listMembers(slug: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    "select leaf_index, commitment, status, included_root, created_at, included_at from members where group_slug = $1 order by leaf_index asc",
    [slug],
  );
}

export async function listScopes(slug: string): Promise<ScopeRow[]> {
  return query<ScopeRow>("select * from scopes where group_slug = $1 order by created_at asc", [slug]);
}

export async function getScopeRow(scopePdaStr: string): Promise<ScopeRow> {
  const rows = await query<ScopeRow>("select * from scopes where scope_pda = $1", [scopePdaStr]);
  if (rows.length === 0) throw new HttpError(404, "scope not found");
  return rows[0];
}

/** Rebuild the LeanIMT exactly as members were enrolled (leaf order). */
export function buildTree(members: Pick<MemberRow, "commitment">[]): Group {
  return new Group(members.map((m) => BigInt(m.commitment)));
}

export function rootHex(group: Group): string {
  return bytesToHex(bigintToBytes32(group.root));
}

/**
 * Create (or adopt) a group: initializes the on-chain Group PDA when it does
 * not exist yet, then records it. Idempotent on slug.
 */
export async function registerGroup(input: { slug: string; name: string; rootValiditySlots?: bigint }): Promise<GroupRow> {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw new HttpError(400, "slug must be lowercase letters, digits and dashes");
  const existing = await query<GroupRow>("select * from groups where slug = $1", [slug]);
  if (existing.length > 0) return existing[0];

  const admin = issuerKeypair();
  const groupId = groupIdFromLabel(`null-group:${slug}`);
  const [pda] = groupPda(groupId);
  const onChain = await fetchGroupAccount(pda);
  if (!onChain) {
    try {
      await sendAndConfirm(
        [
          initializeGroupIx({
            admin: admin.publicKey,
            groupId,
            initialRoot: new Uint8Array(32),
            rootValiditySlots: input.rootValiditySlots ?? DEFAULT_ROOT_VALIDITY_SLOTS,
          }),
        ],
        admin,
      );
    } catch (e) {
      throw new HttpError(502, `initialize_group failed: ${describeProgramError(e)}`);
    }
  } else if (!onChain.admin.equals(admin.publicKey)) {
    throw new HttpError(409, "on-chain group exists with a different administrator");
  }
  const rows = await query<GroupRow>(
    `insert into groups (slug, name, group_id, group_pda, admin_pubkey) values ($1, $2, $3, $4, $5)
     on conflict (slug) do update set name = excluded.name returning *`,
    [slug, input.name.trim().slice(0, 80), bytesToHex(groupId), pda.toBase58(), admin.publicKey.toBase58()],
  );
  return rows[0];
}

function formatCode(bytes: Uint8Array): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 15; i += 1) out += alphabet[bytes[i] % 32];
  return `NULL-${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}`;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/** Mint single-use invitation codes. Plaintext is returned once and never stored. */
export async function createInvitations(slug: string, count: number, label?: string, expiresInHours?: number): Promise<string[]> {
  await getGroupRow(slug);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new HttpError(400, "count must be 1..100");
  const codes: string[] = [];
  const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3_600_000) : null;
  for (let i = 0; i < count; i += 1) {
    const code = formatCode(randomBytes(15));
    await query(
      "insert into invitations (code_hash, group_slug, label, expires_at) values ($1, $2, $3, $4)",
      [sha256hex(code), slug, label ?? null, expiresAt],
    );
    codes.push(code);
  }
  return codes;
}

export interface EnrollResult {
  leafIndex: number;
  commitment: string;
  status: "pending";
  pendingMembers: number;
}

/**
 * Redeem an invitation with a public commitment. Atomic: the invitation row is
 * locked, so a code can never be used twice even under concurrent requests.
 */
export async function enroll(slug: string, codeRaw: string, commitmentRaw: unknown): Promise<EnrollResult> {
  await getGroupRow(slug);
  const commitment = validateCommitment(commitmentRaw);
  const code = normalizeCode(String(codeRaw ?? ""));
  if (!/^NULL-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(code)) throw new HttpError(400, "invitation code format is invalid");
  const codeHash = sha256hex(code);

  return withTransaction(async (client) => {
    // Serialize enrollments per group so leaf indices are dense and ordered.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`enroll:${slug}`]);

    const inv = await client.query(
      "select code_hash, redeemed_at, expires_at from invitations where code_hash = $1 and group_slug = $2 for update",
      [codeHash, slug],
    );
    if (inv.rowCount === 0) throw new HttpError(404, "invitation code not recognized for this group");
    const row = inv.rows[0] as { redeemed_at: string | null; expires_at: string | null };
    if (row.redeemed_at) throw new HttpError(409, "invitation code already used");
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(410, "invitation code expired");

    const dup = await client.query("select 1 from members where group_slug = $1 and commitment = $2", [slug, commitment.toString()]);
    if (dup.rowCount && dup.rowCount > 0) throw new HttpError(409, "commitment already enrolled in this group");

    const next = await client.query<{ next: number }>(
      "select coalesce(max(leaf_index), -1) + 1 as next from members where group_slug = $1",
      [slug],
    );
    const leafIndex = Number(next.rows[0].next);

    await client.query(
      "update invitations set redeemed_at = now(), redeemed_commitment = $1 where code_hash = $2",
      [commitment.toString(), codeHash],
    );
    await client.query(
      "insert into members (group_slug, leaf_index, commitment, status, invitation_hash) values ($1, $2, $3, 'pending', $4)",
      [slug, leafIndex, commitment.toString(), codeHash],
    );
    const pending = await client.query<{ n: string }>(
      "select count(*)::text as n from members where group_slug = $1 and status = 'pending'",
      [slug],
    );
    return { leafIndex, commitment: commitment.toString(), status: "pending", pendingMembers: Number(pending.rows[0].n) };
  });
}

export interface PublishResult {
  root: string;
  rootDecimal: string;
  memberCount: number;
  signature: string | null;
  slot: number | null;
  unchanged: boolean;
}

/**
 * Recompute the tree over every enrolled commitment and publish the root
 * on chain. Members covered by the published root flip to `included`.
 */
export async function publishRoot(slug: string): Promise<PublishResult> {
  const group = await getGroupRow(slug);
  const members = await listMembers(slug);
  if (members.length === 0) throw new HttpError(400, "no members enrolled yet");
  const tree = buildTree(members);
  const root = rootHex(tree);
  const maxLeaf = members[members.length - 1].leaf_index;

  const pda = new PublicKey(group.group_pda);
  const onChain = await fetchGroupAccount(pda);
  if (!onChain) throw new HttpError(502, "on-chain group account missing");
  if (bytesToHex(onChain.currentRoot) === root) {
    await query(
      "update members set status = 'included', included_root = $1, included_at = coalesce(included_at, now()) where group_slug = $2 and leaf_index <= $3",
      [root, slug, maxLeaf],
    );
    return { root, rootDecimal: tree.root.toString(), memberCount: members.length, signature: null, slot: null, unchanged: true };
  }

  const admin = issuerKeypair();
  let sent;
  try {
    sent = await sendAndConfirm(
      [updateGroupRootIx({ admin: admin.publicKey, group: pda, newRoot: hexToBytes(root), memberCount: members.length })],
      admin,
    );
  } catch (e) {
    throw new HttpError(502, `update_group_root failed: ${describeProgramError(e)}`);
  }
  await query(
    "insert into roots (group_slug, root, member_count, tx_signature, slot) values ($1, $2, $3, $4, $5)",
    [slug, root, members.length, sent.signature, sent.slot],
  );
  await query(
    "update members set status = 'included', included_root = $1, included_at = now() where group_slug = $2 and leaf_index <= $3 and status = 'pending'",
    [root, slug, maxLeaf],
  );
  return { root, rootDecimal: tree.root.toString(), memberCount: members.length, signature: sent.signature, slot: sent.slot, unchanged: false };
}

/** Create a verification scope on chain and record it. Idempotent on label. */
export async function createScope(slug: string, label: string, oneTime: boolean): Promise<ScopeRow> {
  const group = await getGroupRow(slug);
  const clean = label.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _:./-]{0,60}$/.test(clean)) throw new HttpError(400, "scope label has unsupported characters");
  const existing = await query<ScopeRow>("select * from scopes where group_slug = $1 and label = $2", [slug, clean]);
  if (existing.length > 0) return existing[0];

  const groupPk = new PublicKey(group.group_pda);
  const scopeId = scopeIdFromLabel(`null-scope:${slug}:${clean}`);
  const [pda] = scopePda(groupPk, scopeId);
  const admin = issuerKeypair();
  let signature: string | null = null;
  const onChain = await fetchScopeAccount(pda);
  if (!onChain) {
    try {
      const sent = await sendAndConfirm(
        [createScopeIx({ admin: admin.publicKey, group: groupPk, scopeId, oneTime })],
        admin,
      );
      signature = sent.signature;
    } catch (e) {
      throw new HttpError(502, `create_scope failed: ${describeProgramError(e)}`);
    }
  } else if (onChain.oneTime !== oneTime) {
    throw new HttpError(409, "scope exists on chain with a different one_time policy");
  }
  const chainScope = (await fetchScopeAccount(pda))!;
  const expected = bigintToBytes32(deriveScopeValue(groupPk.toBytes(), scopeId));
  if (bytesToHex(chainScope.scopeValue) !== bytesToHex(expected)) {
    throw new HttpError(500, "scope value derivation mismatch between client and program");
  }
  const rows = await query<ScopeRow>(
    `insert into scopes (scope_pda, group_slug, label, scope_id, scope_value, one_time, tx_signature)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (scope_pda) do update set label = excluded.label returning *`,
    [pda.toBase58(), slug, clean, bytesToHex(scopeId), bytesToHex(chainScope.scopeValue), chainScope.oneTime, signature],
  );
  return rows[0];
}

export interface MembershipStatus {
  status: "unknown" | "pending" | "included";
  leafIndex: number | null;
  includedRoot: string | null;
  currentRoot: string;
  memberCount: number;
}

export async function membershipStatus(slug: string, commitmentRaw: unknown): Promise<MembershipStatus> {
  const group = await getGroupRow(slug);
  const commitment = validateCommitment(commitmentRaw);
  const rows = await query<MemberRow>(
    "select leaf_index, commitment, status, included_root, created_at, included_at from members where group_slug = $1 and commitment = $2",
    [slug, commitment.toString()],
  );
  const onChain = await fetchGroupAccount(new PublicKey(group.group_pda));
  const currentRoot = onChain ? bytesToHex(onChain.currentRoot) : "";
  const count = await query<{ n: string }>("select count(*)::text as n from members where group_slug = $1 and status = 'included'", [slug]);
  if (rows.length === 0) {
    return { status: "unknown", leafIndex: null, includedRoot: null, currentRoot, memberCount: Number(count[0].n) };
  }
  return {
    status: rows[0].status,
    leafIndex: rows[0].leaf_index,
    includedRoot: rows[0].included_root,
    currentRoot,
    memberCount: Number(count[0].n),
  };
}
