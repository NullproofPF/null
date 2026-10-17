// Tweet thread copy + length check (X counts every URL as 23 characters).
import fs from "node:fs";
import path from "node:path";

export const TWEETS = [
  `NULL is live on Solana mainnet.

Prove you belong to a group without revealing which member you are. Real zero-knowledge proofs, generated in your browser, verified by an on-chain program.

PROVE EVERYTHING. REVEAL NOTHING.

How it works, in 8 posts:`,

  `Every "anonymous" check in crypto still leaks something: your wallet, your login, the address that paid the fee.

NULL separates who you are from what you can prove. Your identity is a random secret that never leaves your device. The chain sees a proof, not a person.`,

  `Three steps.

01 GENERATE: a Semaphore v4 identity, created in the browser, encrypted with your passphrase.
02 AUTHORIZE: an issuer adds your public commitment to a Merkle tree and publishes the root on chain.
03 PROVE: a Groth16 proof that you are in the tree. Nothing else.`,

  `The verifier is an Anchor program using Solana's alt_bn128 syscalls. About 130k compute units per proof.

It rejects unknown roots, replayed nullifiers, wrong scopes, wrong messages and invalid proofs, then writes a public receipt.

EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS`,

  `One identity, one action per scope.

Vote once on a proposal and nobody learns which member voted. Use the same credential somewhere else and nothing links the two.

The scope value is derived on chain, so nobody can invent a convenient scope to act twice.`,

  `You never connect a wallet. A sponsored relayer pays the fee and only sees public proof data.

Honest limits: the issuer knows who enrolled, network metadata exists, and your anonymity set is exactly the real member count. We pad nothing.`,

  `All of it is open source: the Anchor program, the browser prover, the issuer, the relayer, 17 on-chain integration tests, 15 unit tests, the threat model and the artifact hashes.

Read it, break it, tell us.

https://github.com/NullproofPF/null`,

  `Create an identity, redeem a NULL GENESIS invitation, prove membership on mainnet.

nullproof.lol
CA: 4x3554qe9R2j2cwp59gTEZ2zLk3m15vYnjPMazcYNULL`,
];

const URL_RE = /https?:\/\/\S+|\b[a-z0-9-]+\.(?:lol|com|fun|io|org|net)\b/gi;
export function xLength(t) {
  return [...t.replace(URL_RE, "x".repeat(23))].length;
}

if (process.argv[1] && path.basename(process.argv[1]) === "thread.mjs") {
  let ok = true;
  TWEETS.forEach((t, i) => {
    const n = xLength(t);
    const dash = /[\u2013\u2014]/.test(t);
    if (n > 280 || dash) ok = false;
    console.log(`${i + 1}/${TWEETS.length}: ${n} chars${n > 280 ? " OVER 280" : ""}${dash ? " HAS DASH" : ""}`);
  });
  const out = path.resolve(process.cwd(), "marketing/thread/thread.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    `# NULL launch thread\n\n${TWEETS.map((t, i) => `## ${i + 1}/${TWEETS.length} (${xLength(t)} chars) · image: img-${i + 1}.png\n\n${t}\n`).join("\n")}`,
  );
  console.log(ok ? "all tweets within 280, no dashes" : "FIX NEEDED", "->", out);
}
