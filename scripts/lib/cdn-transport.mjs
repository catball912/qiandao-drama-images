import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";

const alternateEdges = new Map([
  ["public.qiandaocdn.com", "treasure.qiandaocdn.com"],
  ["cdn.qiandaoapp.com", "treasure.qiandaocdn.com"],
  ["treasure.qiandaocdn.com", "public.qiandaocdn.com"],
]);
const networkErrors = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"]);

export const hasCdnRoute = (host) => /(?:^|\.)qiandaocdn\.com$|(?:^|\.)qiandaoapp\.com$/.test(host);

function responseBody(incoming) {
  const iterator = incoming[Symbol.asyncIterator]();
  let cancelled = false;
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (cancelled) return;
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) { if (!cancelled) controller.error(error); }
    },
    cancel() { cancelled = true; incoming.destroy(); },
  });
}

function requestAtEdge(url, init, edge, { request, lookup }) {
  return new Promise((resolve, reject) => {
    const options = {
      method: "GET", headers: init.headers, signal: init.signal,
      family: 0, autoSelectFamily: true, autoSelectFamilyAttemptTimeout: 500,
      agent: false, rejectUnauthorized: true,
      // Keep the original hostname for HTTP Host, SNI and certificate checks.
      servername: url.hostname,
      // Return every IPv4 answer. Trying only the first CDN address makes
      // downloads depend on which unreachable edge DNS happens to list first.
      lookup: (_host, settings, callback) => lookup(edge || url.hostname, { ...settings, family: 4 }, callback),
    };
    const outgoing = request(url, options, (incoming) => {
      clearTimeout(timer);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, item);
      }
      const empty = [204, 205, 304].includes(incoming.statusCode);
      if (empty) incoming.resume();
      resolve(new Response(empty ? null : responseBody(incoming), { status: incoming.statusCode, headers }));
    });
    // Bound DNS/TCP/TLS separately from the caller's whole-response deadline.
    const timer = setTimeout(() => outgoing.destroy(Object.assign(new Error("CDN connection timed out"), { code: "ETIMEDOUT" })), 8000);
    outgoing.once("socket", (socket) => {
      socket.once("secureConnect", () => clearTimeout(timer));
    });
    outgoing.once("error", (error) => { clearTimeout(timer); reject(error); });
    outgoing.end();
  });
}

export async function fetchCdn(raw, init = {}, dependencies = {}) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !hasCdnRoute(url.hostname)) {
    throw new Error("Unsupported CDN route");
  }
  const transport = { request: httpsRequest, lookup: dnsLookup, ...dependencies };
  try {
    return await requestAtEdge(url, init, null, transport);
  } catch (error) {
    // Retry network failures only. HTTP denials and TLS failures are returned
    // unchanged; this is another route to the same authenticated TLS hostname.
    if (init.signal?.aborted || !alternateEdges.has(url.hostname) || !networkErrors.has(error.code)) throw error;
    console.warn(JSON.stringify({ event: "cdn_route_retry", host: url.hostname, code: error.code }));
    return requestAtEdge(url, init, alternateEdges.get(url.hostname), transport);
  }
}
