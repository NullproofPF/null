// Render the launch-thread images (1600x900 @2x) in the site's visual language.
//   node tools/thread/render.mjs            -> marketing/thread/img-1.png ... img-8.png
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(process.cwd());
const OUT = path.join(ROOT, "marketing", "thread");
fs.mkdirSync(OUT, { recursive: true });

const dataUri = (p) => `data:image/png;base64,${fs.readFileSync(path.join(ROOT, p)).toString("base64")}`;
const shots = {
  landing: dataUri("docs/screenshots/landing.png"),
  identity: dataUri("docs/screenshots/identity.png"),
  verify: dataUri("docs/screenshots/verify.png"),
  explorer: dataUri("docs/screenshots/explorer.png"),
  github: fs.existsSync(path.join(OUT, "github-repo.png")) ? dataUri("marketing/thread/github-repo.png") : null,
};

const CA = "4x3554qe9R2j2cwp59gTEZ2zLk3m15vYnjPMazcYNULL";
const PROGRAM = "EeESX96fLQvMgRLWU5Fm1HFMofiSNPeoyymCWLAsSJrS";

const BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap');
  :root { --bg:#050505; --fg:#f5f5f5; --muted:#7a7a7a; --muted2:#4a4a4a; --line:#1c1c1c; --panel:#0a0a0a; --ph:#4ade80; --danger:#f87171; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1600px; height: 900px; background: var(--bg); color: var(--fg); overflow: hidden; }
  body { font-family: 'Geist', ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; position: relative; }
  .mono { font-family: 'Geist Mono', ui-monospace, Menlo, monospace; font-variant-ligatures: none; }
  .scan { position:absolute; inset:0; pointer-events:none; background: repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px); }
  .card { position: absolute; inset: 0; padding: 72px; display: flex; flex-direction: column; }
  .top { display:flex; justify-content: space-between; font-size: 18px; letter-spacing: 0.18em; color: var(--muted); }
  .bottom { margin-top:auto; display:flex; justify-content: space-between; font-size: 16px; letter-spacing: 0.16em; color: var(--muted2); }
  .label { font-size: 18px; letter-spacing: 0.22em; color: var(--muted); }
  .ph { color: var(--ph); }
  .muted { color: var(--muted); }
  .wordmark { font-weight: 700; letter-spacing: -0.06em; line-height: 0.85; }
  .panel { background: var(--panel); border: 1px solid var(--line); }
  .frame { background:#000; border:1px solid #262626; overflow:hidden; position: relative; }
  .frame .bar { height: 34px; display:flex; align-items:center; gap:8px; padding: 0 14px; border-bottom:1px solid #1c1c1c; background:#0a0a0a; }
  .frame .bar i { width:10px; height:10px; border-radius:50%; background:#2a2a2a; display:block; }
  .frame .bar span { margin-left: 12px; font-size: 13px; color:#555; letter-spacing: 0.08em; }
  .frame .view { overflow:hidden; position:relative; }
  .frame img { display:block; }
  h1 { font-weight: 700; letter-spacing: -0.03em; line-height: 1.02; }
`;

function shell(body, extraCss = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}${extraCss}</style></head><body>${body}<div class="scan"></div></body></html>`;
}

const top = (n, right = "nullproof.lol") => `<div class="top mono"><span>NULL PROTOCOL / ${String(n).padStart(2, "0")}</span><span>${right}</span></div>`;
const bottom = (left = "SOLANA MAINNET · GROTH16 OVER BN254 · SEMAPHORE V4") => `<div class="bottom mono"><span>${left}</span><span>@NullProofPF</span></div>`;

/** Browser-like frame showing a crop of a full-page screenshot. width = frame width, crop = [y0, y1] in source pixels (1280 wide). */
function frame(src, width, crop, url) {
  const s = width / 1280;
  const h = Math.round((crop[1] - crop[0]) * s);
  return `<div class="frame" style="width:${width}px">
    <div class="bar"><i></i><i></i><i></i><span class="mono">${url}</span></div>
    <div class="view" style="height:${h}px"><img src="${src}" style="width:${width}px; margin-top:${-Math.round(crop[0] * s)}px" /></div>
  </div>`;
}

const cards = [
  // 1 hero
  shell(`<div class="card">
    ${top(1)}
    <div style="display:flex; gap:80px; align-items:flex-end; margin-top:60px">
      <div>
        <div class="wordmark" style="font-size:330px">NULL</div>
        <div class="mono" style="font-size:30px; letter-spacing:0.24em; margin-top:34px">PROVE EVERYTHING.<br/>REVEAL NOTHING.</div>
      </div>
      <div class="panel mono" style="padding:28px 32px; font-size:19px; line-height:1.9; letter-spacing:0.08em; min-width:620px; margin-bottom:12px">
        <div class="muted">NULL PROTOCOL</div>
        <div>NETWORK: <span>SOLANA MAINNET</span></div>
        <div>PROOF SYSTEM: GROTH16</div>
        <div>IDENTITY MODEL: ZERO KNOWLEDGE</div>
        <div style="word-break:break-all">VERIFIER: ${PROGRAM}</div>
        <div>STATUS: <span class="ph">OPERATIONAL</span><span class="ph" style="margin-left:6px">▌</span></div>
      </div>
    </div>
    ${bottom("A ZERO-KNOWLEDGE IDENTITY PROTOCOL BUILT ON SOLANA")}
  </div>`),

  // 2 on chain vs never on chain
  shell(`<div class="card">
    ${top(2)}
    <h1 style="font-size:64px; margin-top:54px; max-width:1300px">The chain sees a proof,<br/>not a person.</h1>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-top:54px">
      <div class="panel" style="padding:34px 38px">
        <div class="label mono ph">ON CHAIN</div>
        <div class="mono" style="font-size:26px; line-height:2; margin-top:18px">
          <div><span class="ph">[ok]</span> group Merkle root</div>
          <div><span class="ph">[ok]</span> scope-bound nullifier</div>
          <div><span class="ph">[ok]</span> message commitment</div>
          <div><span class="ph">[ok]</span> slot and receipt address</div>
        </div>
      </div>
      <div class="panel" style="padding:34px 38px">
        <div class="label mono" style="color:var(--danger)">NEVER ON CHAIN</div>
        <div class="mono" style="font-size:26px; line-height:2; margin-top:18px; color:var(--muted)">
          <div><span style="color:var(--danger)">[--]</span> your identity secret</div>
          <div><span style="color:var(--danger)">[--]</span> which commitment is yours</div>
          <div><span style="color:var(--danger)">[--]</span> your wallet</div>
          <div><span style="color:var(--danger)">[--]</span> your name, login or email</div>
        </div>
      </div>
    </div>
    ${bottom()}
  </div>`),

  // 3 generate (identity screenshot)
  shell(`<div class="card">
    ${top(3, "nullproof.lol/identity")}
    <div style="display:flex; gap:64px; margin-top:48px; align-items:flex-start">
      <div style="width:470px">
        <div class="label mono">01 / GENERATE</div>
        <h1 style="font-size:56px; margin-top:18px">A key that never leaves your device.</h1>
        <div class="mono" style="font-size:19px; line-height:1.9; margin-top:30px; color:var(--muted)">
          <div class="ph">IDENTITY GENERATED</div>
          <div>PRIVATE KEY: [HIDDEN]</div>
          <div>IDENTITY COMMITMENT: [PUBLIC HASH]</div>
          <div>STATUS: UNREGISTERED</div>
        </div>
        <p style="font-size:20px; line-height:1.5; margin-top:30px; color:var(--muted)">Semaphore v4 identity from the browser CSPRNG, encrypted with your passphrase (PBKDF2, AES-256-GCM). Export a backup. Lose both and nobody can recover it, by design.</p>
      </div>
      ${frame(shots.identity, 920, [0, 1157 * 0.7], "nullproof.lol/identity")}
    </div>
    ${bottom()}
  </div>`),

  // 4 verifier
  shell(`<div class="card">
    ${top(4)}
    <div style="display:flex; gap:72px; margin-top:48px">
      <div style="width:620px">
        <div class="label mono">ON-CHAIN VERIFIER</div>
        <h1 style="font-size:60px; margin-top:18px">verify_proof fails closed.</h1>
        <p style="font-size:21px; line-height:1.5; margin-top:28px; color:var(--muted)">An Anchor program checks the Groth16 pairing through Solana's alt_bn128 syscalls. Public inputs are rebuilt from chain state; the caller supplies a proof and nothing else of consequence.</p>
        <div class="mono" style="font-size:18px; margin-top:34px; color:var(--muted); line-height:1.8">
          <div>PROGRAM</div><div style="color:var(--fg); word-break:break-all">${PROGRAM}</div>
          <div style="margin-top:10px">COMPUTE: ~130,000 CU PER PROOF</div>
        </div>
      </div>
      <div class="panel mono" style="flex:1; padding:30px 36px; font-size:22px; line-height:2.05">
        <div class="label" style="margin-bottom:8px">REJECTION ORDER</div>
        <div><span class="muted">1</span>&nbsp; malformed proof bytes</div>
        <div><span class="muted">2</span>&nbsp; non-canonical field elements</div>
        <div><span class="muted">3</span>&nbsp; root never published, or expired</div>
        <div><span class="muted">4</span>&nbsp; scope from another group</div>
        <div><span class="muted">5</span>&nbsp; wrong message binding</div>
        <div><span class="muted">6</span>&nbsp; nullifier already consumed</div>
        <div><span class="muted">7</span>&nbsp; invalid pairing</div>
        <div class="ph" style="margin-top:10px">then: write NullifierRecord + Receipt</div>
      </div>
    </div>
    ${bottom()}
  </div>`),

  // 5 scopes
  shell(`<div class="card">
    ${top(5)}
    <div class="label mono" style="margin-top:48px">SCOPE-BOUND NULLIFIERS</div>
    <h1 style="font-size:60px; margin-top:18px">One identity. One action per scope.<br/><span class="muted">Nothing links the two.</span></h1>
    <div style="display:flex; align-items:center; gap:36px; margin-top:62px">
      <div class="panel mono" style="padding:30px 34px; font-size:22px; width:420px">
        <div class="label">IDENTITY</div>
        <div style="margin-top:12px">secret: <span class="muted">[HIDDEN]</span></div>
        <div>commitment: <span class="muted">0x2f9a...c41e</span></div>
      </div>
      <div class="mono" style="font-size:40px; color:var(--muted2)">→</div>
      <div style="display:flex; flex-direction:column; gap:22px; flex:1">
        <div class="panel mono" style="padding:24px 30px; font-size:21px">
          <div class="label">SCOPE genesis-vote <span class="muted2">(one-time)</span></div>
          <div style="margin-top:8px">nullifier = Poseidon(hash(scope), secret) = <span class="ph">0x7a31...9be0</span></div>
          <div class="muted">second proof in this scope: <span style="color:var(--danger)">rejected</span></div>
        </div>
        <div class="panel mono" style="padding:24px 30px; font-size:21px">
          <div class="label">SCOPE genesis-access <span class="muted2">(multi-use)</span></div>
          <div style="margin-top:8px">nullifier = Poseidon(hash(scope), secret) = <span class="ph">0xd3c8...114f</span></div>
          <div class="muted">unrelated to the vote nullifier: <span class="ph">unlinkable</span></div>
        </div>
      </div>
    </div>
    ${bottom("SCOPE VALUE IS DERIVED ON CHAIN FROM THE SCOPE ACCOUNT, NEVER SUPPLIED BY THE PROVER")}
  </div>`),

  // 6 verify screenshot
  shell(`<div class="card">
    ${top(6, "nullproof.lol/verify")}
    <div style="display:flex; gap:56px; margin-top:44px; align-items:flex-start">
      <div style="width:440px">
        <div class="label mono">03 / PROVE</div>
        <h1 style="font-size:52px; margin-top:18px">Every step is real.</h1>
        <div class="mono" style="font-size:19px; line-height:2; margin-top:26px">
          <div><span class="ph">[ok]</span> FETCHING GROUP</div>
          <div><span class="ph">[ok]</span> RECONSTRUCTING MERKLE TREE</div>
          <div><span class="ph">[ok]</span> GENERATING WITNESS</div>
          <div><span class="ph">[ok]</span> GENERATING ZERO-KNOWLEDGE PROOF</div>
          <div><span class="ph">[ok]</span> VALIDATING PROOF</div>
          <div><span class="ph">[ok]</span> SUBMITTING TO SOLANA</div>
          <div class="ph">[ok] VERIFIED</div>
        </div>
        <p style="font-size:19px; line-height:1.5; margin-top:24px; color:var(--muted)">VERIFIED appears only after the program accepted the proof. A relayer pays the fee; you never connect a wallet.</p>
      </div>
      ${frame(shots.verify, 960, [714, 1434], "nullproof.lol/verify")}
    </div>
    ${bottom()}
  </div>`),

  // 7 open source
  shell(`<div class="card">
    ${top(7, "github.com/NullproofPF/null")}
    <div style="display:flex; gap:56px; margin-top:44px; align-items:flex-start">
      <div style="width:520px">
        <div class="label mono">OPEN SOURCE · MIT</div>
        <h1 style="font-size:56px; margin-top:18px">Read it. Break it. Tell us.</h1>
        <div class="mono" style="font-size:19px; line-height:2; margin-top:26px; color:var(--muted)">
          <div><span class="ph">+</span> Anchor verifier program (Rust)</div>
          <div><span class="ph">+</span> browser prover and encrypted vault</div>
          <div><span class="ph">+</span> issuer, relayer, explorer</div>
          <div><span class="ph">+</span> 17 LiteSVM tests, 15 unit tests</div>
          <div><span class="ph">+</span> threat model, artifact hashes, API docs</div>
          <div><span class="ph">+</span> CI on every push, MIT licensed</div>
        </div>
        <div class="mono" style="font-size:24px; margin-top:34px; color:var(--fg)">github.com/NullproofPF/null</div>
      </div>
      ${shots.github ? frame(shots.github, 950, [0, 900 * 0.78], "github.com/NullproofPF/null") : `<div class="panel" style="flex:1; height:560px"></div>`}
    </div>
    ${bottom()}
  </div>`),

  // 8 final
  shell(`<div class="card">
    ${top(8)}
    <div style="display:flex; gap:64px; margin-top:44px; align-items:center">
      <div style="width:780px">
        <div class="label mono ph">LIVE ON SOLANA MAINNET</div>
        <h1 style="font-size:92px; margin-top:22px; letter-spacing:-0.04em">nullproof.lol</h1>
        <div class="mono" style="font-size:20px; margin-top:34px; color:var(--muted); letter-spacing:0.12em">CA</div>
        <div class="mono" style="font-size:25px; margin-top:6px; white-space:nowrap; line-height:1.4">${CA}</div>
        <p style="font-size:20px; line-height:1.5; margin-top:30px; color:var(--muted)">Create an identity. Redeem a NULL GENESIS invitation. Prove membership without revealing the member.</p>
      </div>
      ${frame(shots.landing, 680, [0, 1000], "nullproof.lol")}
    </div>
    ${bottom("PROVE EVERYTHING. REVEAL NOTHING.")}
  </div>`),
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
for (const [i, html] of cards.entries()) {
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(OUT, `img-${i + 1}.png`);
  await page.screenshot({ path: file, type: "png" });
  console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}
await browser.close();
