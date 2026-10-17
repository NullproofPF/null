/**
 * Fixed protocol constants shared by the browser, the issuer/relayer backend,
 * the fixture generator and (by hand-mirroring) the Solana program.
 *
 * Changing any of these breaks compatibility with the on-chain verifying key.
 */

/** BN254 (alt_bn128) base field modulus p. G1/G2 coordinates live here. */
export const BN254_FIELD_MODULUS =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

/** BN254 scalar field modulus r. Circuit signals (public inputs) live here. */
export const BN254_SCALAR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Depth of the Semaphore circuit the Solana program is compiled against.
 * The program embeds the verifying key for exactly this depth. Groups with
 * fewer members still work: Semaphore pads missing siblings with 0 and passes
 * the real depth as `merkleProofLength`.
 */
export const MERKLE_TREE_DEPTH = 16;

/** Capacity implied by the depth above. */
export const MAX_GROUP_SIZE = 2 ** MERKLE_TREE_DEPTH;

/**
 * Semaphore artifact release the wasm / zkey in public/artifacts were taken from.
 * See docs/ARTIFACTS.md for the origin, hashes and trusted-setup provenance.
 */
export const SEMAPHORE_ARTIFACT_VERSION = "4.13.0";
export const SEMAPHORE_PACKAGE_VERSION = "4.14.4";

export const ARTIFACT_WASM_PATH = `/artifacts/semaphore-${MERKLE_TREE_DEPTH}.wasm`;
export const ARTIFACT_ZKEY_PATH = `/artifacts/semaphore-${MERKLE_TREE_DEPTH}.zkey`;

export const ARTIFACT_SHA256 = {
  wasm: "06df31461d17db86897fc234f0e6e5f5e2f6add1b8c821b5c6ae75030b3e0d7c",
  zkey: "948763c7315a337b7722c0344a28af4be66fbbc618474d6dbe9036e799d1a3b5",
} as const;

/** Protocol version string shown in the explorer and stored nowhere on chain. */
export const PROTOCOL_VERSION = "0.1.0";

/**
 * Domain separator used by the Solana program when it derives a scope value.
 * Mirrors `SCOPE_DOMAIN` in program/programs/null-verifier/src/lib.rs.
 */
export const SCOPE_DOMAIN = "null-protocol/scope/v1";
