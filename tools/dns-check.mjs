const D = "nullproof.lol";
const q = async (name, type) => {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${name}&type=${type}`, { headers: { accept: "application/dns-json" } });
  const j = await r.json();
  return (j.Answer ?? []).map((a) => a.data).join(" | ") || "(none)";
};
console.log("apex A           ", await q(D, "A"));
console.log("www CNAME        ", await q(`www.${D}`, "CNAME"));
console.log("verify TXT       ", await q(`_railway-verify.${D}`, "TXT"));
console.log("verify www TXT   ", await q(`_railway-verify.www.${D}`, "TXT"));
console.log("wildcard probe   ", await q(`zz${Date.now()}.${D}`, "A"));
