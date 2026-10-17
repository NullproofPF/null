// Operator CLI for the issuer API. Reads ADMIN_TOKEN from .env.local and the host from .domain.txt
// (override with NULL_API_BASE). The token is never printed.
//   node tools/admin-cli.mjs invites <count> [label]
//   node tools/admin-cli.mjs publish-root
//   node tools/admin-cli.mjs scope <label> [--multi]
//   node tools/admin-cli.mjs group <slug> <name...>
import fs from "node:fs";
import path from "node:path";

const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const token = env.match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("ADMIN_TOKEN missing in .env.local");
const base =
  process.env.NULL_API_BASE ??
  (fs.existsSync(".domain.txt") ? `https://${fs.readFileSync(".domain.txt", "utf8").trim()}` : "http://localhost:3000");
const group = process.env.NULL_GROUP ?? "null-genesis";

async function post(route, body) {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.error ?? "request failed"}`);
  return json;
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "invites": {
    const r = await post("/api/admin/invitations", { group, count: Number(rest[0] ?? 1), label: rest[1] });
    console.log(r.codes.join("\n"));
    break;
  }
  case "publish-root": {
    const r = await post("/api/admin/publish-root", { group });
    console.log(JSON.stringify(r, null, 2));
    break;
  }
  case "scope": {
    const r = await post("/api/admin/scopes", { group, label: rest[0], oneTime: !rest.includes("--multi") });
    console.log(JSON.stringify(r, null, 2));
    break;
  }
  case "group": {
    const r = await post("/api/admin/groups", { slug: rest[0], name: rest.slice(1).join(" ") });
    console.log(JSON.stringify(r, null, 2));
    break;
  }
  default:
    console.error("usage: invites <count> [label] | publish-root | scope <label> [--multi] | group <slug> <name>");
    process.exit(1);
}
