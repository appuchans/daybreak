import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { metaDescription, fetchDescription, enrichSnippets } from "../scripts/describe.mjs";

const LONG = "Union home minister said the full implementation of the new criminal laws would speed up cases.";

test("metaDescription prefers og:description, handles attribute order and quotes, decodes entities", () => {
  const html = `<head><meta name="description" content="short cut"><meta content='Kim&#039;s plan &amp; more, in full sentence form here.' property='og:description'></head>`;
  assert.equal(metaDescription(html), "Kim's plan & more, in full sentence form here.");
  assert.equal(metaDescription(`<meta name="description" content="Only the plain one">`), "Only the plain one");
  assert.equal(metaDescription(`<meta property="og:title" content="x">`), null);
});

async function withPages(handler, fn) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test("fetchDescription reads only the head of a large page and ignores non-HTML or errors", async () => {
  await withPages((req, res) => {
    if (req.url === "/big") {
      res.setHeader("content-type", "text/html");
      res.write(`<html><head><meta property="og:description" content="${LONG}"></head><body>`);
      res.write("x".repeat(2_000_000));
      return res.end();
    }
    if (req.url === "/json") { res.setHeader("content-type", "application/json"); return res.end("{}"); }
    res.statusCode = 403; res.end("no");
  }, async (base) => {
    assert.equal(await fetchDescription(`${base}/big`), LONG);
    assert.equal(await fetchDescription(`${base}/json`), null);
    assert.equal(await fetchDescription(`${base}/blocked`), null);
  });
});

const it = (n, over = {}) => ({ title: `Headline number ${n} which is rather long`, snippet: "", url: `https://a.example/${n}`, source: "A", ...over });
const noSleep = () => Promise.resolve();

test("enrichSnippets fills empty descriptions, skips full ones, and reuses earlier answers", async () => {
  const sections = { a: { items: [it(1), it(2, { snippet: LONG }), it(3)] } };
  const previous = { sections: { a: { items: [{ url: "https://a.example/3", snippet: "Earlier fetched description that is long enough to keep." }] } } };
  const fetched = [];
  const stats = await enrichSnippets(sections, { previous, fetchDesc: async (u) => { fetched.push(u); return LONG; }, delayMs: 0, sleep: noSleep });
  assert.deepEqual(fetched, ["https://a.example/1"]);
  assert.equal(sections.a.items[0].snippet, LONG);
  assert.equal(sections.a.items[1].snippet, LONG);
  assert.equal(sections.a.items[2].snippet, "Earlier fetched description that is long enough to keep.");
  assert.deepEqual([stats.fetched, stats.reused], [1, 1]);
});

test("enrichSnippets rejects short, headline-copy and repeated (site boilerplate) descriptions, and respects the cap", async () => {
  const mk = () => ({ a: { items: [it(1), it(2), it(3), it(4), it(5)] } });
  const answers = { "https://a.example/1": "Too short.", "https://a.example/2": "Headline number 2 which is rather long and then some more words follow", "https://a.example/3": "Generic site description shown on every page of this site.", "https://a.example/4": "Generic site description shown on every page of this site." };
  const sections = mk();
  const stats = await enrichSnippets(sections, { fetchDesc: async (u) => answers[u], maxPerRun: 4, delayMs: 0, sleep: noSleep });
  assert.deepEqual(sections.a.items.map((i) => i.snippet), ["", "", "", "", ""]);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.fetched, 0);
});

test("a fetch error never throws and is logged", async () => {
  const logs = [];
  const sections = { a: { items: [it(1)] } };
  const stats = await enrichSnippets(sections, { fetchDesc: async () => { throw new Error("fetch failed"); }, delayMs: 0, sleep: noSleep, log: (m) => logs.push(m) });
  assert.equal(stats.failed, 1);
  assert.ok(logs[0].includes("fetch failed"));
  assert.equal(sections.a.items[0].snippet, "");
});
