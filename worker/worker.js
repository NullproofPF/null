// Stopgap bridge: serves nullproof.lol from the Railway deployment while the zone's DNS still points at
// Cloudflare's proxy. Goes inert as soon as the grey-cloud CNAME records point straight at Railway.
const ORIGIN = "https://web-production-ac7d0.up.railway.app";

const bridge = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    const upstream = new Request(new URL(url.pathname + url.search, ORIGIN).toString(), request);
    upstream.headers.set("x-forwarded-host", url.hostname);
    const res = await fetch(upstream, { redirect: "manual" });
    const headers = new Headers(res.headers);
    headers.set("x-null-source", "worker-proxy");
    return new Response(res.body, { status: res.status, headers });
  },
};

export default bridge;
