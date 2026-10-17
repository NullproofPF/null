// Upsert service variables on Railway from .env.local via the GraphQL API.
// Secrets never touch the command line or stdout.
//   node tools/railway-vars.mjs <serviceName> [--only KEY,KEY]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".railway", "config.json"), "utf8"));
const token = cfg.user?.accessToken ?? cfg.user?.token;
if (!token) throw new Error("no railway token; run `railway login`");
const cwdKey = Object.keys(cfg.projects ?? {}).find((k) => path.resolve(k) === path.resolve(process.cwd()));
const link = (cwdKey && cfg.projects[cwdKey]) ?? Object.values(cfg.projects ?? {})[0];
if (!link) throw new Error("no linked railway project");
const serviceName = process.argv[2];
if (!serviceName) throw new Error("usage: node tools/railway-vars.mjs <serviceName>");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? new Set(process.argv[onlyIdx + 1].split(",")) : null;

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

const project = await gql(
  `query($id: String!) { project(id: $id) { services { edges { node { id name } } } } }`,
  { id: link.project },
);
const service = project.project.services.edges.map((e) => e.node).find((s) => s.name === serviceName);
if (!service) throw new Error(`service '${serviceName}' not found`);

const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const vars = {};
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  if (only && !only.has(m[1])) continue;
  if (m[1] === "DATABASE_URL") continue; // the service references Postgres internally
  vars[m[1]] = m[2];
}
vars.DATABASE_URL = "${{Postgres.DATABASE_URL}}";
vars.NODE_OPTIONS = "--dns-result-order=ipv6first";
vars.NODE_ENV = "production";

await gql(
  `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
  {
    input: {
      projectId: link.project,
      environmentId: link.environment,
      serviceId: service.id,
      variables: vars,
      skipDeploys: true,
    },
  },
);
console.log(`upserted ${Object.keys(vars).length} variables on service ${serviceName}: ${Object.keys(vars).join(", ")}`);
