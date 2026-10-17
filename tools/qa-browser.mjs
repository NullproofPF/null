// Headless browser QA of the live NULL site: identity -> enroll -> (admin publishes root) -> prove -> explorer.
// Bundled headless Chromium only (never a branded channel). Screenshots land in tools/shots/.
//   node tools/qa-browser.mjs <base-url> <invitation-code>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
const code = process.argv[3];
if (!base || !code) {
  console.error("usage: node tools/qa-browser.mjs <base-url> <invitation-code>");
  process.exit(1);
}
const env = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
const adminToken = env.match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim();
const shots = path.join(process.cwd(), "tools", "shots");
fs.mkdirSync(shots, { recursive: true });
const PASS = "correct horse battery staple";
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--disable-extensions", "--disable-background-networking"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
const shot = (n) => page.screenshot({ path: path.join(shots, `${n}.png`), fullPage: true });

try {
  // 1. Landing terminal reports OPERATIONAL.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /OPERATIONAL|DEGRADED|UNREACHABLE/.test(document.body.innerText), null, { timeout: 30000 });
  const landing = await page.innerText("body");
  step("landing status", /STATUS: OPERATIONAL/.test(landing), landing.match(/STATUS: \w+/)?.[0]);
  await shot("01-landing");

  // 2. Create identity.
  await page.goto(`${base}/identity`, { waitUntil: "networkidle" });
  await page.waitForSelector("input[placeholder^='passphrase']", { timeout: 20000 });
  await page.fill("input[placeholder^='passphrase']", PASS);
  await page.fill("input[placeholder='confirm passphrase']", PASS);
  await page.click("text=[ Create Identity ]");
  await page.waitForSelector("text=IDENTITY GENERATED", { timeout: 60000 });
  const identityText = await page.innerText("body");
  const commitment = identityText.match(/IDENTITY COMMITMENT:\s*(\d+)/)?.[1];
  step("identity generated", Boolean(commitment) && /PRIVATE KEY: \[HIDDEN\]/.test(identityText), `commitment ${commitment?.slice(0, 12)}...`);
  await page.waitForFunction(() => /STATUS: (UNREGISTERED|ENROLLED|AUTHORIZED)/.test(document.body.innerText), null, { timeout: 20000 });
  step("identity status unregistered", /STATUS: UNREGISTERED/.test(await page.innerText("body")));
  await shot("02-identity");

  // 3. Enroll with the invitation.
  await page.goto(`${base}/credentials`, { waitUntil: "networkidle" });
  await page.waitForSelector("input[placeholder='NULL-XXXXX-XXXXX-XXXXX']", { timeout: 30000 });
  await page.fill("input[placeholder='NULL-XXXXX-XXXXX-XXXXX']", code);
  await page.click("text=[ Redeem Invitation ]");
  await page.waitForFunction(() => /COMMITMENT ACCEPTED AS LEAF|already|invalid|not recognized/.test(document.body.innerText), null, { timeout: 30000 });
  const enrollText = await page.innerText("body");
  step("enrollment accepted", /COMMITMENT ACCEPTED AS LEAF/.test(enrollText), enrollText.match(/COMMITMENT ACCEPTED AS LEAF \d+/)?.[0]);
  await shot("03-credentials-pending");

  // 4. Issuer publishes the root (admin API).
  const pub = await fetch(`${base}/api/admin/publish-root`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ group: "null-genesis" }),
  }).then((r) => r.json());
  step("root published", Boolean(pub.root), `${pub.memberCount} members, tx ${pub.signature ?? "unchanged"}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => /INCLUDED AS LEAF/.test(document.body.innerText), null, { timeout: 30000 });
  step("membership included", true, (await page.innerText("body")).match(/INCLUDED AS LEAF \d+/)?.[0]);
  await shot("04-credentials-included");

  // 5. Prove in the browser.
  await page.goto(`${base}/verify`, { waitUntil: "networkidle" });
  await page.waitForSelector("input[placeholder='passphrase']", { timeout: 30000 });
  await page.fill("input[placeholder='passphrase']", PASS);
  await page.click("button:has-text('Unlock')");
  await page.waitForFunction(() => !document.querySelector("input[placeholder='passphrase']"), null, { timeout: 60000 });
  await page.waitForSelector("text=[ Prove Membership ]", { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector("select")?.options.length > 0 && document.querySelector("select").value !== "", null, { timeout: 20000 });
  await page.fill("input[placeholder^='null:']", "browser-qa:yes");
  const t0 = Date.now();
  await page.click("text=[ Prove Membership ]");
  await page.waitForFunction(() => /\[ok\] VERIFIED|\[xx\]/.test(document.body.innerText), null, { timeout: 180000 });
  const verifyText = await page.innerText("body");
  const verified = /\[ok\] VERIFIED/.test(verifyText);
  const sig = verifyText.match(/TRANSACTION\s+([1-9A-HJ-NP-Za-km-z]{60,})/)?.[1];
  const proofMs = verifyText.match(/(\d+) ms in browser/)?.[1];
  step("browser proof verified on chain", verified, `tx ${sig ?? "none"}; proof ${proofMs ?? "?"} ms; total ${Date.now() - t0} ms`);
  if (!verified) console.log(verifyText.slice(0, 2000));
  await shot("05-verify");

  // 6. Second attempt in the same one-time scope must be rejected.
  await page.fill("input[placeholder^='null:']", "browser-qa:again");
  await page.click("text=[ Prove Membership ]");
  await page.waitForFunction(() => /nullifier already consumed|\[ok\] VERIFIED.*\n[\s\S]*VERIFICATION RECEIPT/.test(document.body.innerText) && /\[xx\] SUBMITTING TO SOLANA|nullifier already consumed/.test(document.body.innerText), null, { timeout: 180000 }).catch(() => {});
  const replayText = await page.innerText("body");
  step("replay rejected", /nullifier already consumed/.test(replayText), replayText.match(/nullifier already consumed[^\n]*/)?.[0]);
  await shot("06-replay-rejected");

  // 7. Explorer shows the receipt.
  await page.goto(`${base}/explorer`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /COMPLETED VERIFICATIONS/.test(document.body.innerText), null, { timeout: 30000 });
  const explorerText = await page.innerText("body");
  step("explorer lists receipt tx", sig ? explorerText.includes(sig.slice(0, 20)) : false);
  await shot("07-explorer");
} catch (e) {
  step("unexpected failure", false, e instanceof Error ? e.message : String(e));
  await shot("99-failure").catch(() => {});
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(shots, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
