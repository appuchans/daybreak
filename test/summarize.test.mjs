import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cleanSummary, geminiCaller, summarizeSections, HaltSummaries, eligible } from "../scripts/summarize.mjs";

const LONG = "A description long enough to be worth summarizing, with plenty of detail beyond the headline itself.";
const item = (n, over = {}) => ({ title: `Headline ${n}`, snippet: LONG, url: `https://a.example/${n}`, source: "A", publishedAt: n, clickbait: true, ...over });
const noSleep = () => Promise.resolve();

test("cleanSummary: SKIP, empty and overlong are rejected; quotes and entities are cleaned", () => {
  assert.equal(cleanSummary("SKIP"), null);
  assert.equal(cleanSummary(" skip. "), null);
  assert.equal(cleanSummary(""), null);
  assert.equal(cleanSummary("x".repeat(301)), null);
  assert.equal(cleanSummary(`"Kim&#039;s test <b>fired</b>."`), "Kim's test fired.");
});

test("eligible needs a clickbait flag and a description that says something beyond the headline", () => {
  assert.ok(eligible(item(1)));
  assert.ok(!eligible(item(1, { clickbait: false })));
  assert.ok(!eligible(item(1, { clickbait: undefined })));
  assert.ok(!eligible(item(1, { snippet: "Short." })));
  const t = "A headline that is repeated verbatim as the description, long enough to pass the length check";
  assert.ok(!eligible({ title: t, snippet: t }));
});

async function withGemini(handler, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => { seen.push({ url: req.url, headers: req.headers, body }); handler(req, res, seen.length); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${server.address().port}`, seen); } finally { server.close(); }
}
const reply = (text) => (req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })); };

test("geminiCaller sends the documented request and keeps the key out of the URL", async () => {
  await withGemini(reply("Summary here."), async (baseUrl, seen) => {
    const out = await geminiCaller({ apiKey: "SECRET", baseUrl, minIntervalMs: 0 })(item(1));
    assert.equal(out, "Summary here.");
    const [req] = seen;
    assert.equal(req.url, "/v1beta/models/gemini-3.5-flash-lite:generateContent");
    assert.equal(req.headers["x-goog-api-key"], "SECRET");
    assert.ok(!req.url.includes("SECRET"));
    const body = JSON.parse(req.body);
    assert.ok(body.system_instruction.parts[0].text.includes("SKIP"));
    assert.ok(body.contents[0].parts[0].text.includes("<headline>Headline 1</headline>"));
    assert.equal(body.generationConfig.maxOutputTokens, 200);
  });
});

test("geminiCaller: 429 and key errors halt; server errors are ordinary failures", async () => {
  for (const [status, halts] of [[429, true], [403, true], [400, true], [404, true], [500, false]]) {
    await withGemini((req, res) => { res.statusCode = status; res.end("{}"); }, async (baseUrl) => {
      const p = geminiCaller({ apiKey: "k", baseUrl, minIntervalMs: 0, retryDelayMs: 0 })(item(1));
      if (halts) await assert.rejects(p, HaltSummaries);
      else await assert.rejects(p, (e) => e instanceof Error && !(e instanceof HaltSummaries));
    });
  }
});

test("generate: a 429 is retried after Google's suggested delay; three in a row halt", async () => {
  const limited = (req, res) => { res.statusCode = 429; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "0.05s" }] } })); };
  await withGemini((req, res, n) => (n === 1 ? limited(req, res) : reply("After retry.")(req, res)), async (baseUrl, seen) => {
    const started = Date.now();
    assert.equal(await geminiCaller({ apiKey: "k", baseUrl, minIntervalMs: 0, retryDelayMs: 0 })(item(1)), "After retry.");
    assert.equal(seen.length, 2);
    assert.ok(Date.now() - started >= 45, "waited for RetryInfo's delay");
  });
  await withGemini(limited, async (baseUrl, seen) => {
    await assert.rejects(geminiCaller({ apiKey: "k", baseUrl, minIntervalMs: 0, retryDelayMs: 0 })(item(1)), HaltSummaries);
    assert.equal(seen.length, 3);
  });
});

test("generate: a 429 asking for a long wait (the daily quota) halts at once instead of waiting", async () => {
  const daily = (req, res) => { res.statusCode = 429; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30347s" }] } })); };
  await withGemini(daily, async (baseUrl, seen) => {
    const started = Date.now();
    await assert.rejects(geminiCaller({ apiKey: "k", baseUrl, minIntervalMs: 0, retryDelayMs: 0 })(item(1)), HaltSummaries);
    assert.equal(seen.length, 1, "no retry");
    assert.ok(Date.now() - started < 2000);
  });
});

test("generate: calls are spaced at least minIntervalMs apart, even when made at once", async () => {
  await withGemini(reply("ok"), async (baseUrl) => {
    const call = geminiCaller({ apiKey: "k", baseUrl, minIntervalMs: 60 });
    const started = Date.now();
    await Promise.all([call(item(1)), call(item(2)), call(item(3))]);
    assert.ok(Date.now() - started >= 115, `three calls took ${Date.now() - started} ms`);
  });
});

test("summarizeSections reuses earlier summaries by canonical URL and only calls for new stories", async () => {
  const sections = { w: { items: [item(1, { url: "https://a.example/1?utm=x" }), item(2)] } };
  const previous = { sections: { w: { items: [{ url: "https://www.a.example/1", aiSummary: "Kept." }] } } };
  const calls = [];
  const stats = await summarizeSections(sections, { call: async (s) => { calls.push(s.title); return "New."; }, previous, delayMs: 0, sleep: noSleep });
  assert.equal(sections.w.items[0].aiSummary, "Kept.");
  assert.equal(sections.w.items[1].aiSummary, "New.");
  assert.deepEqual(calls, ["Headline 2"]);
  assert.deepEqual([stats.reused, stats.added], [1, 1]);
});

test("the per-run budget goes to lead stories across sections first", async () => {
  const sections = { a: { items: [item(1), item(2), item(3)] }, b: { items: [item(11), item(12)] } };
  const calls = [];
  await summarizeSections(sections, { call: async (s) => { calls.push(s.title); return "S."; }, maxNew: 3, delayMs: 0, sleep: noSleep });
  assert.deepEqual(calls, ["Headline 1", "Headline 11", "Headline 2"]);
  assert.equal(sections.a.items[2].aiSummary, undefined);
});

test("short descriptions and SKIP answers get no summary", async () => {
  const sections = { a: { items: [item(1, { snippet: "Too short." }), item(2)] } };
  const stats = await summarizeSections(sections, { call: async () => null, delayMs: 0, sleep: noSleep });
  assert.equal(sections.a.items[0].aiSummary, undefined);
  assert.equal(sections.a.items[1].aiSummary, undefined);
  assert.equal(stats.skipped, 2);
});

test("a halt stops new calls but keeps reusing earlier summaries", async () => {
  const sections = { a: { items: [item(1), item(2), item(3)] } };
  const previous = { sections: { a: { items: [{ url: "https://a.example/3", aiSummary: "Old." }] } } };
  let n = 0;
  const logs = [];
  const stats = await summarizeSections(sections, { call: async () => { n++; throw new HaltSummaries("rate limited (HTTP 429)"); }, previous, delayMs: 0, sleep: noSleep, log: (m) => logs.push(m) });
  assert.equal(n, 1);
  assert.equal(sections.a.items[2].aiSummary, "Old.");
  assert.equal(stats.halted, "rate limited (HTTP 429)");
  assert.ok(logs[0].startsWith("::warning::"));
});

test("three failures in a row stop the run; a success resets the count", async () => {
  const mk = () => ({ a: { items: [1, 2, 3, 4, 5].map((n) => item(n)) } });
  let n = 0;
  const stats = await summarizeSections(mk(), { call: async () => { n++; throw new Error("HTTP 500"); }, delayMs: 0, sleep: noSleep, log: () => {} });
  assert.equal(n, 3);
  assert.equal(stats.failed, 3);
  let k = 0;
  const ok = await summarizeSections(mk(), { call: async () => { k++; if (k % 3 === 0) return "S."; throw new Error("x"); }, delayMs: 0, sleep: noSleep, log: () => {} });
  assert.equal(ok.halted, null);
});

test("failures carry Google's status and message, with the key masked", async () => {
  await withGemini((req, res) => { res.statusCode = 404; res.end(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "models/x is not found; key SECRET is not valid" } })); }, async (baseUrl) => {
    await assert.rejects(geminiCaller({ apiKey: "SECRET", baseUrl })(item(1)), (e) => {
      assert.ok(e instanceof HaltSummaries);
      assert.ok(e.message.startsWith("HTTP 404 NOT_FOUND models/x is not found"));
      assert.ok(!e.message.includes("SECRET"));
      return true;
    });
  });
});

test("the first three ordinary failures are logged with their cause", async () => {
  const logs = [];
  await summarizeSections({ a: { items: [1, 2, 3, 4].map((n) => item(n)) } }, { call: async () => { throw new Error("HTTP 503 UNAVAILABLE overloaded"); }, delayMs: 0, sleep: noSleep, log: (m) => logs.push(m) });
  assert.equal(logs.filter((m) => m.includes("HTTP 503 UNAVAILABLE overloaded")).length, 3);
});

test("only clickbait-flagged stories are summarized, and old summaries of other stories are not reused", async () => {
  const sections = { a: { items: [item(1, { clickbait: false }), item(2), item(3, { clickbait: undefined })] } };
  const previous = { sections: { a: { items: [{ url: "https://a.example/1", aiSummary: "Old restatement." }] } } };
  const calls = [];
  await summarizeSections(sections, { call: async (s) => { calls.push(s.title); return "What it is about."; }, previous, delayMs: 0, sleep: noSleep });
  assert.deepEqual(calls, ["Headline 2"]);
  assert.equal(sections.a.items[0].aiSummary, undefined);
  assert.equal(sections.a.items[1].aiSummary, "What it is about.");
  assert.equal(sections.a.items[2].aiSummary, undefined);
});
