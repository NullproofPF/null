import { NextResponse } from "next/server";
import { adminToken } from "./env";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(
    data,
    {
      ...init,
      headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
    },
  );
}

/** Wrap a route handler so thrown HttpErrors become JSON responses and nothing leaks. */
export function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  return fn().catch((e: unknown) => {
    if (e instanceof HttpError) {
      return json({ error: e.message, details: e.details ?? null }, { status: e.status });
    }
    const message = e instanceof Error ? e.message : "internal error";
    console.error("[api]", message);
    // Never echo connection strings or key material.
    const safe = /postgres|password|secret|keypair/i.test(message) ? "internal error" : message;
    return json({ error: safe }, { status: 500 });
  });
}

/** Constant-time compare of the Authorization bearer token with ADMIN_TOKEN. */
export function requireAdmin(request: Request): void {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expected = adminToken();
  if (presented.length === 0 || presented.length !== expected.length) throw new HttpError(401, "unauthorized");
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) throw new HttpError(401, "unauthorized");
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

/** Best-effort client address for rate limiting (behind Railway's proxy). */
export function clientAddress(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
