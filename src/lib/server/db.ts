/**
 * Postgres access. One pool per process, schema bootstrapped once.
 *
 * Data model notes (privacy):
 *   - members: only PUBLIC identity commitments. No secrets, no wallets.
 *   - invitations: only the sha256 of the code; plaintext is shown once to the admin.
 *   - relay_rate_limits: salted hash of the caller's IP, hourly buckets, purged after 2h.
 */
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { databaseUrl } from "./env";

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl(),
      max: 5,
      idleTimeoutMillis: 30_000,
      ssl: databaseUrl().includes("railway") || databaseUrl().includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

const SCHEMA_SQL = `
create table if not exists groups (
  slug text primary key,
  name text not null,
  group_id text not null unique,
  group_pda text not null unique,
  admin_pubkey text not null,
  created_at timestamptz not null default now()
);

create table if not exists members (
  id bigserial primary key,
  group_slug text not null references groups(slug),
  leaf_index integer not null,
  commitment text not null,
  status text not null default 'pending',
  invitation_hash text,
  included_root text,
  created_at timestamptz not null default now(),
  included_at timestamptz,
  unique (group_slug, leaf_index),
  unique (group_slug, commitment)
);

create table if not exists invitations (
  code_hash text primary key,
  group_slug text not null references groups(slug),
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_commitment text
);

create table if not exists roots (
  id bigserial primary key,
  group_slug text not null references groups(slug),
  root text not null,
  member_count integer not null,
  tx_signature text,
  slot bigint,
  published_at timestamptz not null default now()
);

create table if not exists scopes (
  scope_pda text primary key,
  group_slug text not null references groups(slug),
  label text not null,
  scope_id text not null,
  scope_value text not null,
  one_time boolean not null,
  tx_signature text,
  created_at timestamptz not null default now(),
  unique (group_slug, label)
);

create table if not exists verifications (
  receipt_pda text primary key,
  group_slug text not null references groups(slug),
  scope_pda text not null references scopes(scope_pda),
  receipt_index bigint not null,
  root text not null,
  nullifier text not null,
  message text not null,
  tx_signature text not null,
  slot bigint,
  verified_at timestamptz not null default now()
);

create index if not exists verifications_verified_at_idx on verifications (verified_at desc);

create table if not exists relay_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket_key, window_start)
);
`;

export async function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const client = await getPool().connect();
    try {
      await client.query(SCHEMA_SQL);
    } finally {
      client.release();
    }
  })().catch((e) => {
    schemaReady = undefined;
    throw e;
  });
  await schemaReady;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function dbHealthy(): Promise<{ ok: boolean; error?: string }> {
  try {
    await query("select 1");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "database error" };
  }
}
