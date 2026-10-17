// Fill .env.local with server secrets read from the op-desk secrets folder.
// Never prints secret values. Idempotent: existing keys are replaced.
//   node tools/write-env.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SECRETS = process.env.NULL_SECRETS_DIR ?? "Y:/Hermes/op-desk/secrets/project-null";
const HELIUS_KEY_FILE = "Y:/Hermes/op-desk/secrets/helius.key";
const envPath = path.join(process.cwd(), ".env.local");

const read = (f) => fs.readFileSync(f, "utf8").trim();
const compact = (jsonArrayText) => JSON.stringify(JSON.parse(jsonArrayText));

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const set = (key, value) => {
  const line = `${key}=${value}`;
  if (new RegExp(`^${key}=.*$`, "m").test(env)) env = env.replace(new RegExp(`^${key}=.*$`, "m"), line);
  else env += `${env.length === 0 || env.endsWith("\n") ? "" : "\n"}${line}\n`;
};
const current = (key) => env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];

const deployer = compact(read(path.join(SECRETS, "deployer.json")));
const relayerFile = path.join(SECRETS, "relayer.json");
const relayer = fs.existsSync(relayerFile) ? compact(read(relayerFile)) : deployer;
const mainnetDeployerFile = path.join(SECRETS, "mainnet-deployer.json");
const cluster = process.env.NULL_CLUSTER ?? current("NEXT_PUBLIC_SOLANA_CLUSTER") ?? "mainnet-beta";
const mainnet = cluster === "mainnet-beta";
if (mainnet && !fs.existsSync(mainnetDeployerFile)) throw new Error("mainnet-deployer.json missing");
const issuer = mainnet ? compact(read(mainnetDeployerFile)) : deployer;

set("ISSUER_ADMIN_KEYPAIR", issuer);
// Until the dedicated relayer is funded the issuer key also pays relayed transactions.
set("RELAYER_KEYPAIR", process.env.USE_DEDICATED_RELAYER === "1" || mainnet ? relayer : issuer);
if (!current("ADMIN_TOKEN")) set("ADMIN_TOKEN", crypto.randomBytes(24).toString("hex"));
if (!current("RELAY_SALT")) set("RELAY_SALT", crypto.randomBytes(16).toString("hex"));
const heliusHost = mainnet ? "mainnet.helius-rpc.com" : "devnet.helius-rpc.com";
const publicRpc = mainnet ? "https://solana-rpc.publicnode.com" : "https://api.devnet.solana.com";
if (fs.existsSync(HELIUS_KEY_FILE)) {
  set("SOLANA_RPC_URL", `https://${heliusHost}/?api-key=${read(HELIUS_KEY_FILE)}`);
} else {
  set("SOLANA_RPC_URL", publicRpc);
}
set("NEXT_PUBLIC_SOLANA_RPC_URL", publicRpc);
set("NEXT_PUBLIC_SOLANA_CLUSTER", cluster);
set("NEXT_PUBLIC_NULL_PROGRAM_ID", "EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS");
set("NEXT_PUBLIC_GITHUB_URL", process.env.NULL_GITHUB_URL ?? current("NEXT_PUBLIC_GITHUB_URL") ?? "");
set("NEXT_PUBLIC_DOCS_URL", current("NEXT_PUBLIC_DOCS_URL") ?? "/protocol");
// Project links: pass NULL_TOKEN_CA / NULL_PUMP_URL / NULL_X_URL / NULL_TOKEN_NOTE to set or change them.
for (const [envName, key] of [
  ["NULL_TOKEN_CA", "NEXT_PUBLIC_TOKEN_CA"],
  ["NULL_PUMP_URL", "NEXT_PUBLIC_PUMP_URL"],
  ["NULL_X_URL", "NEXT_PUBLIC_X_URL"],
  ["NULL_TOKEN_NOTE", "NEXT_PUBLIC_TOKEN_NOTE"],
]) {
  if (process.env[envName] !== undefined) set(key, process.env[envName]);
}

fs.writeFileSync(envPath, env);
const keys = env
  .split("\n")
  .filter((l) => l.includes("="))
  .map((l) => l.split("=")[0]);
console.log("wrote .env.local with keys:", keys.join(", "));
