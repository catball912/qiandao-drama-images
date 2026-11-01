import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPublicQiandaoClient, signQiandaoPublicUrl } from "../scripts/lib/public-client.mjs";

const firstUrl = "https://api.qiandao.com/treasure/flora/v2/entry/ssr?entryType=spu&entryId=695041088494490294";
const groupUrl = "https://api.qiandao.com/treasure/v1/spu/view-image-groups?spuId=695041088494490294";
const timeUrl = "https://api.qiandao.cn/now";
const fixedClock = 1700000000000;
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

test("Anonymous metadata matches fixed goldens from the published Web module", () => {
  // Captured from the original source module, not recomputed with this implementation.
  // 來源核對摘要：references/protocol.md；固定輸出來自原公開模組。
  const goldens = [
    [firstUrl, "d0e716a23066a3a7302a6473d6b1ad271f6945c7a826554cdffaf1a588937a35"],
    ["https://api.qiandao.com/treasure/flora/v2/entry/ssr?entryId=870707790300079386&entryType=spu", "7c6237df191a21286a77a9e7b5bedd7ebbc5cf0520144171f86703e878dc7cc9"],
    [firstUrl + "&example=a%20b%2Bc%2Fd", "126d84a0445d62de3d939eeb5fee4e0b6bdbee8a4dfa4c974ed0d9b95cbf3d85"],
  ];
  for (const [url, digest] of goldens) {
    const headers = signQiandaoPublicUrl(url, { timestamp: 1700000000123, requestId: "rea-offline-parity" });
    assert.equal(createHash("sha256").update(headers["X-Request-Sign"]).digest("hex"), digest);
    assert.equal(headers["X-Request-Timestamp"], "1700000000123");
    assert.equal(headers["X-Request-Package-Sign-Version"], "0.0.1");
    assert.equal(headers["X-Request-Sign-Version"], "v1");
    assert.equal(headers["X-Request-Sign-Type"], "HMAC_SHA256");
    assert.equal(Object.keys(headers).length, 5);
  }
});

test("Origins, endpoints, methods and unsupported query shapes are rejected before I/O", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network"); };
  const get = createPublicQiandaoClient();
  for (const url of [
    "http://api.qiandao.com/now", "https://api.qiandao.com.evil.test/now", "https://user:pass@api.qiandao.com/now",
    "https://api.qiandao.com:8443/now", "https://api.qiandao.com/user/users/me", timeUrl + "#fragment",
    firstUrl + "&entryId=duplicate", firstUrl + "&items[]=one",
  ]) await assert.rejects(get(url), /Unsupported|scalar/);
  await assert.rejects(get(firstUrl, { method: "POST" }), /GET/);
  await assert.rejects(get(firstUrl, { body: "not-empty" }), /GET/);
  assert.equal(calls, 0);
});

test("Reads are anonymous, public headers replace caller metadata, and server clock offset is applied", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === timeUrl) return Response.json({ data: { timestamp: fixedClock / 1000 + 120 } });
    return Response.json({ code: "0", data: { officialImage: {} } });
  };
  const get = createPublicQiandaoClient({ clock: () => fixedClock });
  const response = await get(groupUrl, { credentials: "include", headers: {
    Authorization: "Bearer must-not-leave", Cookie: "must-not-leave=1", "Proxy-Authorization": "must-not-leave",
    "X-Request-Sign": "old", "X-Request-Id": "old-id", "X-Request-Package-Id": "old-package", "X-Test": "retained",
  } });
  assert.equal((await response.json()).code, "0");
  assert.equal(calls.length, 2);
  const { init } = calls[1];
  assert.equal(init.method, "GET");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  for (const name of ["authorization", "cookie", "proxy-authorization", "x-request-id"]) assert.equal(init.headers.get(name), null);
  assert.equal(init.headers.get("x-client-package-id"), "1044");
  assert.equal(init.headers.get("x-request-package-id"), "1044");
  assert.equal(init.headers.get("x-echoing-env"), "test-z");
  assert.equal(init.headers.get("x-request-timestamp"), String(fixedClock + 120000));
  assert.notEqual(init.headers.get("x-request-sign"), "old");
  assert.equal(init.headers.get("x-test"), "retained");
});

test("Concurrent readers share a recent clock sample, small differences stay unadjusted, and expiry refreshes it", async () => {
  let now = fixedClock, clockCalls = 0, finishClock;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    if (url === timeUrl) {
      clockCalls++;
      if (clockCalls === 1) return new Promise((resolve) => { finishClock = resolve; });
      return Response.json({ data: { timestamp: now / 1000 + 120 } });
    }
    requests.push(init.headers.get("x-request-timestamp"));
    return Response.json({ ok: true });
  };
  const get = createPublicQiandaoClient({ clock: () => now });
  const first = get(firstUrl), second = get(groupUrl);
  assert.equal(clockCalls, 1);
  finishClock(Response.json({ data: { timestamp: now / 1000 + 59 } }));
  await Promise.all([first, second]);
  assert.deepEqual(requests, [String(now), String(now)]);
  await get(firstUrl);
  assert.equal(clockCalls, 1);
  now += 360000;
  await get(firstUrl);
  assert.equal(clockCalls, 2);
  assert.equal(requests.at(-1), String(now + 120000));
});

test("A failed public clock does not prevent reads or cause a probe on every request", async () => {
  let clockCalls = 0, apiCalls = 0, now = fixedClock;
  globalThis.fetch = async (url, init) => {
    if (url === timeUrl) {
      clockCalls++;
      return clockCalls === 1 ? new Response("unavailable", { status: 503 }) : Response.json({ data: { timestamp: 1e300 } });
    }
    apiCalls++;
    assert.equal(init.headers.get("x-request-timestamp"), String(now));
    return Response.json({ ok: true });
  };
  const get = createPublicQiandaoClient({ clock: () => now });
  await get(firstUrl); await get(groupUrl);
  assert.equal(clockCalls, 1);
  assert.equal(apiCalls, 2);
  now += 60000;
  await get(firstUrl);
  assert.equal(clockCalls, 2);
  assert.equal(apiCalls, 3);
});

test("Cancelling one reader while calibrating does not cancel another reader", async () => {
  let finishClock, apiCalls = 0;
  globalThis.fetch = async (url) => {
    if (url === timeUrl) return new Promise((resolve) => { finishClock = resolve; });
    apiCalls++;
    return Response.json({ ok: true });
  };
  const get = createPublicQiandaoClient({ clock: () => fixedClock });
  const controller = new AbortController();
  const first = get(firstUrl, { signal: controller.signal }), second = get(groupUrl);
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(first, { name: "AbortError" });
  finishClock(Response.json({ data: { timestamp: fixedClock / 1000 } }));
  assert.equal((await second).status, 200);
  assert.equal(apiCalls, 1);
});

test("Cancellation also bounds an API fetch that has not returned headers", async () => {
  let reachedApi;
  const started = new Promise((resolve) => { reachedApi = resolve; });
  globalThis.fetch = async (url) => {
    if (url === timeUrl) return Response.json({ data: { timestamp: fixedClock / 1000 } });
    reachedApi();
    return new Promise(() => {});
  };
  const get = createPublicQiandaoClient({ clock: () => fixedClock });
  const controller = new AbortController(), result = get(firstUrl, { signal: controller.signal });
  await started;
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(result, { name: "AbortError" });
});

test("An unresponsive clock has its own deadline and does not block the API permanently", { timeout: 5000 }, async () => {
  let apiCalls = 0;
  const keepAlive = setInterval(() => {}, 250);
  try {
    globalThis.fetch = async (url) => {
      if (url === timeUrl) return new Promise(() => {});
      apiCalls++;
      return Response.json({ ok: true });
    };
    const get = createPublicQiandaoClient({ clock: () => fixedClock });
    assert.equal((await get(firstUrl)).status, 200);
    assert.equal(apiCalls, 1);
  } finally { clearInterval(keepAlive); }
});

test("Direct public time reads are unsigned, anonymous and do not recursively calibrate", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, timeUrl);
    assert.equal(init.credentials, "omit");
    for (const name of ["authorization", "cookie", "x-request-sign", "x-request-timestamp"]) assert.equal(init.headers.get(name), null);
    return Response.json({ data: { timestamp: fixedClock / 1000 } });
  };
  const get = createPublicQiandaoClient({ clock: () => fixedClock });
  await get(timeUrl, { headers: { Authorization: "do-not-forward", Cookie: "do-not-forward", "X-Request-Sign": "old", "X-Request-Timestamp": "old" } });
  assert.equal(calls, 1);
  assert.deepEqual(signQiandaoPublicUrl(timeUrl), {});
});
