import { createHmac } from "node:crypto";

// Interoperability with the published anonymous Web client, not a user token.
// Source: https://assets.qiandaocdn.com/web-bundle/cherry/_nuxt/Bf96USLE.js
// SHA-256: b38fd6f46cc21320b123758015cf85498b8e521c5e640c3030c5af523d389769
// The public ht.production constant is assembled from that module's literals.
const publishedClientKey = "2TJhRTpCpUIgnWl3qwIaoMMt3KhL2nkC";
const origins = new Set(["https://api.qiandao.com", "https://api.qiandao.cn"]);
const paths = new Set(["/treasure/flora/v2/entry/ssr", "/treasure/v1/spu/view-image-groups", "/now"]);
const publicHeaders = { "x-client-package-id": "1044", "x-request-package-id": "1044", "x-echoing-env": "test-z" };
const clockUrl = "https://api.qiandao.cn/now";
const clockTimeoutMs = 2000, requestTimeoutMs = 8000, clockTtlMs = 300000, clockRetryMs = 30000;

function checkedUrl(raw) {
  const url = new URL(raw);
  if (!origins.has(url.origin) || url.username || url.password || url.hash || !paths.has(url.pathname)) {
    throw new Error("Unsupported public Qiandao API URL");
  }
  const entries = [...url.searchParams.entries()];
  if (entries.some(([name]) => /[\[\]]/.test(name)) || new Set(entries.map(([name]) => name)).size !== entries.length) {
    throw new Error("Only scalar public API queries are supported");
  }
  return url;
}

export function signQiandaoPublicUrl(raw, { timestamp = Date.now(), requestId = "", timeOffsetMs = 0 } = {}) {
  const url = checkedUrl(raw);
  if (url.pathname === "/now") return {};
  const time = Number(timestamp) + Number(timeOffsetMs);
  if (!Number.isSafeInteger(time) || time <= 0 || typeof requestId !== "string") throw new Error("Invalid public request metadata");
  const entries = [...url.searchParams.entries()].sort(([left], [right]) => left > right ? -1 : left < right ? 1 : 0);
  // The original client encodes sorted query keys twice and omits the '?' separator.
  const query = entries.map(([name, value]) => encodeURIComponent(encodeURIComponent(name)) + "=" + encodeURIComponent(value)).join("&");
  const input = url.pathname + query + requestId + String(time);
  const hex = createHmac("sha256", publishedClientKey).update(input, "utf8").digest("hex");
  return {
    "X-Request-Sign": Buffer.from(hex, "utf8").toString("base64"),
    "X-Request-Timestamp": String(time),
    "X-Request-Package-Sign-Version": "0.0.1",
    "X-Request-Sign-Version": "v1",
    "X-Request-Sign-Type": "HMAC_SHA256",
  };
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}

export function createPublicQiandaoClient({ clock = () => Date.now() } = {}) {
  let offset = 0, validUntil = -Infinity, pendingClock = null;

  async function calibrateClock() {
    const signal = AbortSignal.timeout(clockTimeoutMs);
    try {
      const response = await abortable(globalThis.fetch(clockUrl, {
        method: "GET", credentials: "omit", redirect: "error", headers: { Accept: "application/json" }, signal,
      }), signal);
      if (!response.ok) throw new Error("Public clock unavailable");
      const body = await abortable(response.json(), signal);
      const serverMillis = Number(body?.data?.timestamp) * 1000;
      if (!Number.isSafeInteger(serverMillis) || serverMillis <= 0) throw new Error("Invalid public clock");
      const difference = serverMillis - clock();
      offset = Math.abs(difference) > 60000 ? difference : 0;
      validUntil = clock() + clockTtlMs;
    } catch {
      // Preserve a previously measured offset and retry later; API reads still proceed.
      validUntil = clock() + clockRetryMs;
    }
  }

  return async function getPublicQiandao(raw, init = {}) {
    const url = checkedUrl(raw);
    if (String(init.method || "GET").toUpperCase() !== "GET" || init.body != null) throw new Error("Only public API GET requests are supported");
    init.signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(requestTimeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    if (url.pathname !== "/now" && clock() >= validUntil) {
      // Concurrent readers share calibration; one reader's cancellation cannot cancel the others.
      if (!pendingClock) pendingClock = calibrateClock().finally(() => { pendingClock = null; });
      await abortable(pendingClock, signal);
    }
    signal.throwIfAborted();
    const headers = new Headers(init.headers);
    for (const name of ["authorization", "cookie", "cookie2", "proxy-authorization", "x-request-sign", "x-request-timestamp", "x-request-package-sign-version", "x-request-sign-version", "x-request-sign-type", "x-request-id"]) headers.delete(name);
    for (const [name, value] of Object.entries({ ...publicHeaders, ...signQiandaoPublicUrl(url, { timestamp: clock(), timeOffsetMs: offset }) })) headers.set(name, value);
    return abortable(globalThis.fetch(url.href, { ...init, method: "GET", body: undefined, headers, signal, credentials: "omit", redirect: "error" }), signal);
  };
}

export const getPublicQiandao = createPublicQiandaoClient();
