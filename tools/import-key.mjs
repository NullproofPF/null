// Import a Solana secret key file (base58 string, JSON byte array, or hex) into the project secrets folder
// as a solana-keygen compatible JSON file, then delete the source. Prints the public key only.
//   node tools/import-key.mjs <source-file> <name>
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const [src, name] = process.argv.slice(2);
if (!src || !name) {
  console.error("usage: node tools/import-key.mjs <source-file> <name>");
  process.exit(1);
}
const SECRETS = process.env.NULL_SECRETS_DIR ?? "Y:/Hermes/op-desk/secrets/project-null";
const raw = fs.readFileSync(src, "utf8").trim();

let secret;
if (raw.startsWith("[")) secret = Uint8Array.from(JSON.parse(raw));
else if (/^[0-9a-fA-F]{128}$/.test(raw)) secret = Uint8Array.from(Buffer.from(raw, "hex"));
else secret = bs58.decode(raw);

let kp;
if (secret.length === 64) kp = Keypair.fromSecretKey(secret);
else if (secret.length === 32) kp = Keypair.fromSeed(secret);
else throw new Error(`unexpected key length ${secret.length}`);

fs.mkdirSync(SECRETS, { recursive: true });
const dest = path.join(SECRETS, `${name}.json`);
if (fs.existsSync(dest)) throw new Error(`${dest} already exists; refusing to overwrite`);
fs.writeFileSync(dest, JSON.stringify(Array.from(kp.secretKey)));
fs.rmSync(src);
console.log(`imported ${name}: ${kp.publicKey.toBase58()}`);
console.log(`stored at ${dest}; source file removed`);
