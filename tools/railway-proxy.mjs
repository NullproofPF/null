// Create (or reuse) a Railway TCP proxy for the Postgres service and write DATABASE_URL into .env.local.
// Uses the CLI's own session token from ~/.railway/config.json. Prints nothing secret.
//   node tools/railway-proxy.mjs <postgresServiceId>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".railway", "config.json"), "utf8"));
const token = cfg.user?.accessToken ?? cfg.user?.token;
if (!token) throw new Error("no railway token; run `railway login`");
const cwdKey = Object.keys(cfg.projects ?? {}).find((k) => path.resolve(k) === path.resolve(process.cwd()));
const link = (cwdKey && cfg.projects[cwdKey]) ?? Object.values(cfg.projects ?? {})[0];
if (!link) throw new Error("no linked railway project; run `railway init` or `railway link`");
const environmentId = process.env.RAILWAY_ENV_ID ?? link.environment;
const serviceId = process.argv[2];
if (!serviceId) throw new Error("usage: node tools/railway-proxy.mjs <postgresServiceId>");

async function gql(query, variables) {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const existing = await gql(
  `query($environmentId: String!, $serviceId: String!) { tcpProxies(environmentId: $environmentId, serviceId: $serviceId) { id domain proxyPort applicationPort } }`,
  { environmentId, serviceId },
);
let proxy = existing.tcpProxies.find((p) => p.applicationPort === 5432);
if (!proxy) {
  const created = await gql(
    `mutation($input: TCPProxyCreateInput!) { tcpProxyCreate(input: $input) { id domain proxyPort applicationPort } }`,
    { input: { environmentId, serviceId, applicationPort: 5432 } },
  );
  proxy = created.tcpProxyCreate;
  console.log("created tcp proxy");
} else {
  console.log("tcp proxy exists");
}
const host = String(proxy.domain).replace(/\.$/, "");
console.log(`host ${host} port ${proxy.proxyPort}`);

const vars = await gql(
  `query($projectId: String!, $environmentId: String!, $serviceId: String!) { variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) }`,
  { projectId: link.project, environmentId, serviceId },
);
const v = vars.variables;
const user = v.PGUSER ?? "postgres";
const db = v.PGDATABASE ?? "railway";
const pw = v.PGPASSWORD ?? v.POSTGRES_PASSWORD;
if (!pw) throw new Error("no PGPASSWORD on service");
const url = `postgresql://${user}:${encodeURIComponent(pw)}@${host}:${proxy.proxyPort}/${db}`;

const envPath = path.join(process.cwd(), ".env.local");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (/^DATABASE_URL=.*$/m.test(env)) env = env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`);
else env += `${env.endsWith("\n") || env.length === 0 ? "" : "\n"}DATABASE_URL=${url}\n`;
fs.writeFileSync(envPath, env);
console.log("DATABASE_URL written to .env.local (host " + host + ")");
