// Cloudflare zone helper using the wrangler OAuth token (never printed).
//   node tools/cf-zone.mjs <zone> info            -> zone id, account, name servers, DNS records
//   node tools/cf-zone.mjs <zone> set-records <apexTarget> <apexTxt> <wwwTarget> <wwwTxt>
import fs from "node:fs";
import path from "node:path";

const cfg = path.join(process.env.APPDATA, "xdg.config", ".wrangler", "config", "default.toml");
const m = fs.readFileSync(cfg, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
if (!m) throw new Error("no oauth token in wrangler config");
const TOKEN = m[1];
const API = "https://api.cloudflare.com/client/v4";

async function cf(method, p, body) {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!j.success) throw new Error(`${method} ${p}: ${JSON.stringify(j.errors)}`);
  return j.result;
}

const [zoneName, cmd, ...rest] = process.argv.slice(2);
const zones = await cf("GET", `/zones?name=${zoneName}`);
if (!zones.length) throw new Error(`zone ${zoneName} not visible to this login`);
const z = zones[0];
console.log(`zone ${z.name} id=${z.id} status=${z.status} account=${z.account?.name} (${z.account?.id}) ns=${(z.name_servers ?? []).join(",")}`);

if (cmd === "info") {
  const recs = await cf("GET", `/zones/${z.id}/dns_records?per_page=100`);
  for (const r of recs) console.log(`  ${r.type.padEnd(6)} ${r.name.padEnd(28)} ${String(r.content).slice(0, 70).padEnd(70)} proxied=${r.proxied}`);
  if (!recs.length) console.log("  (no records)");
} else if (cmd === "set-records") {
  const [apexTarget, apexTxt, wwwTarget, wwwTxt] = rest;
  const recs = await cf("GET", `/zones/${z.id}/dns_records?per_page=100`);
  // remove anything on @ and www that would shadow the CNAMEs
  for (const r of recs) {
    if ((r.name === zoneName || r.name === `www.${zoneName}`) && ["A", "AAAA", "CNAME"].includes(r.type)) {
      await cf("DELETE", `/zones/${z.id}/dns_records/${r.id}`);
      console.log(`deleted ${r.type} ${r.name} -> ${r.content}`);
    }
  }
  const want = [
    { type: "CNAME", name: zoneName, content: apexTarget, proxied: false, ttl: 1 },
    { type: "TXT", name: `_railway-verify.${zoneName}`, content: apexTxt, ttl: 1 },
    { type: "CNAME", name: `www.${zoneName}`, content: wwwTarget, proxied: false, ttl: 1 },
    { type: "TXT", name: `_railway-verify.www.${zoneName}`, content: wwwTxt, ttl: 1 },
  ];
  const fresh = await cf("GET", `/zones/${z.id}/dns_records?per_page=100`);
  for (const w of want) {
    const existing = fresh.find((r) => r.type === w.type && r.name === w.name);
    if (existing) {
      await cf("PUT", `/zones/${z.id}/dns_records/${existing.id}`, w);
      console.log(`updated ${w.type} ${w.name} -> ${w.content}`);
    } else {
      await cf("POST", `/zones/${z.id}/dns_records`, w);
      console.log(`created ${w.type} ${w.name} -> ${w.content}`);
    }
  }
} else {
  throw new Error("unknown command");
}
