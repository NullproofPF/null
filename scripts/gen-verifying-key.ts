/**
 * Regenerates program/programs/null-verifier/src/verifying_key.rs from the
 * verification key shipped in @semaphore-protocol/proof.
 *
 *   npx tsx scripts/gen-verifying-key.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { renderRustVerifyingKey } from "./lib/verifying-key";
import { MERKLE_TREE_DEPTH } from "../src/lib/zk/constants";

const out = path.resolve(process.cwd(), "program/programs/null-verifier/src/verifying_key.rs");
const source = renderRustVerifyingKey(MERKLE_TREE_DEPTH);
writeFileSync(out, source);
console.log(`wrote ${out} (${source.length} bytes, depth ${MERKLE_TREE_DEPTH})`);
