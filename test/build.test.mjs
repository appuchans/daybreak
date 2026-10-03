// End-to-end run of scripts/build-news.mjs against a local HTTP server standing in for feeds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = resolve("scripts/build-news.mjs");
const feed = (title, n) => `<rss version="2.0"><channel>${Array.from({ length: n }, (_, i) =>
  `<item><title>${title} ${i}</title><link>https://x.example/${title}/${i}</link><pubDate>Sat, 03 Oct 2026 0${i}:00:00 GMT</pubDate></item>`).join("")}</channel></rss>`;

async function withServer(routes, fn) {
  const server = createServer((req, res) => {
    const body = routes[req.url];
    if (body === undefined) { res.statusCode = 500; res.end("down"); } else res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

async function build(dir, config, previous, extraEnv = {}) {
  const cfg = join(dir, "feeds.json");
  await writeFile(cfg, JSON.stringify(config));
  const env = { ...process.env, GEMINI_API_KEY: "", DESCRIBE_MAX_PER_RUN: "0", FEEDS_CONFIG: cfg, PREVIOUS_NEWS: join(dir, "previous-news.json"), ...extraEnv };
  if (previous) await writeFile(env.PREVIOUS_NEWS, JSON.stringify(previous));
  return run("node", [script], { cwd: dir, env }).then(
    async (r) => ({ code: 0, news: JSON.parse(await readFile(join(dir, "news.json"), "utf8")), out: r.stdout }),
    (e) => ({ code: e.code, out: e.stdout }),
  );
}

test("a dead feed keeps its previous items and the other feed still publishes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daybreak-"));
  await withServer({ "/a": feed("A", 3) }, async (base) => {
    const config = { perSource: 4, perSection: 12, sections: [{ id: "world", label: "World", feeds: [
      { name: "Alive", url: `${base}/a` }, { name: "Dead", url: `${base}/dead` }] }] };
    const previous = { sections: { world: { items: [{ title: "Old dead story", snippet: "", url: "https://d.example/1", source: "Dead", publishedAt: 1, alsoReportedBy: [] }] } } };
    const r = await build(dir, config, previous);
    assert.equal(r.code, 0);
    const titles = r.news.sections.world.items.map((i) => i.title);
    assert.ok(titles.includes("Old dead story"));
    assert.equal(titles.filter((t) => t.startsWith("A ")).length, 3);
    assert.equal(r.news.feedStatus.find((s) => s.name === "Dead").ok, false);
  });
});

test("refuses to publish when a section ends up empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daybreak-"));
  await withServer({}, async (base) => {
    const config = { perSource: 4, perSection: 12, sections: [{ id: "world", label: "World", feeds: [{ name: "Dead", url: `${base}/dead` }] }] };
    const r = await build(dir, config, null);
    assert.notEqual(r.code, 0);
  });
});

test("a story carried by two sections is kept only in the later tab, and the earlier tab backfills", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daybreak-"));
  const item = (t, n) => `<item><title>${t}</title><link>https://x.example/${n}</link><pubDate>Sat, 03 Oct 2026 0${n}:00:00 GMT</pubDate></item>`;
  const xml = (...items) => `<rss version="2.0"><channel>${items.join("")}</channel></rss>`;
  await withServer({
    "/world1": xml(item("Shared incident", 9), item("World only", 5)),
    "/world2": xml(item("World backfill", 4)),
    "/india1": xml(item("Shared incident", 9), item("India only", 6)),
    "/india2": xml(item("India other", 3)),
  }, async (base) => {
    const config = { perSource: 4, perSection: 12, sections: [
      { id: "world", label: "World", feeds: [{ name: "W1", url: `${base}/world1` }, { name: "W2", url: `${base}/world2` }] },
      { id: "india", label: "India", feeds: [{ name: "I1", url: `${base}/india1` }, { name: "I2", url: `${base}/india2` }] },
    ] };
    const r = await build(dir, config, null);
    assert.equal(r.code, 0);
    const titles = (id) => r.news.sections[id].items.map((i) => i.title);
    assert.deepEqual(r.news.order, ["world", "india"]);
    assert.ok(titles("india").includes("Shared incident"));
    assert.ok(!titles("world").includes("Shared incident"));
    assert.deepEqual(titles("world").sort(), ["World backfill", "World only"]);
  });
});

test("AI: off without a key; with one, clickbait-flagged stories get a what-it-is-about line and the key never reaches news.json", async () => {
  const long = "A description long enough to be worth summarizing, with plenty of detail beyond the headline itself.";
  const xml = `<rss version="2.0"><channel><item><title>Story</title><link>https://x.example/s</link><description>${long}</description><pubDate>Sat, 03 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  await withServer({ "/a": xml }, async (base) => {
    const config = { perSource: 4, perSection: 12, sections: [{ id: "world", label: "World", feeds: [{ name: "A", url: `${base}/a` }] }] };
    const off = await build(await mkdtemp(join(tmpdir(), "daybreak-")), config, null);
    assert.equal(off.code, 0);
    assert.equal(off.news.sections.world.items[0].aiSummary, undefined);
    assert.ok(off.out.includes("AI summaries: off"));

    const gemini = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body);
        const classify = parsed.generationConfig.response_mime_type === "application/json";
        const text = classify ? JSON.stringify([{ id: 0, scope: "national", importance: 4, clickbait: true }]) : "One sentence summary.";
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
      });
    });
    await new Promise((r) => gemini.listen(0, "127.0.0.1", r));
    try {
      const on = await build(await mkdtemp(join(tmpdir(), "daybreak-")), config, null, { GEMINI_API_KEY: "TOPSECRET", GEMINI_BASE_URL: `http://127.0.0.1:${gemini.address().port}`, SUMMARY_DELAY_MS: "0" });
      assert.equal(on.code, 0);
      assert.equal(on.news.sections.world.items[0].aiSummary, "One sentence summary.");
      assert.ok(on.out.includes("AI summaries: reused=0 added=1"));
      assert.equal(on.news.sections.world.items[0].clickbait, true);
      assert.ok(!JSON.stringify(on.news).includes("TOPSECRET"));
      assert.ok(!on.out.includes("TOPSECRET"));
    } finally { gemini.close(); }
  });
});

test("AI classification drops a local story from a classified section and caches the answers", async () => {
  const mk = (title, n, desc = "") => `<item><title>${title}</title><link>https://x.example/${n}</link><description>${desc}</description><pubDate>Sat, 03 Oct 2026 0${n}:00:00 GMT</pubDate></item>`;
  const xml = `<rss version="2.0"><channel>${mk("Parliament passes the national budget", 5)}${mk("Village road bridge planned in small town", 6)}${mk("Unclassified edge case story here", 7)}</channel></rss>`;
  const dir = await mkdtemp(join(tmpdir(), "daybreak-"));
  const seenPrompts = [];
  const gemini = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const user = JSON.parse(body).contents[0].parts[0].text;
      seenPrompts.push(JSON.parse(body).generationConfig.response_mime_type);
      const items = JSON.parse(user.split("Items:\n")[1]);
      const rows = items.filter((i) => !/edge case/.test(i.headline)).map((i) => ({ id: i.id, scope: /Village/.test(i.headline) ? "local" : "national", importance: /Village/.test(i.headline) ? 2 : 5 }));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(rows) }] } }] }));
    });
  });
  await new Promise((r) => gemini.listen(0, "127.0.0.1", r));
  try {
    await withServer({ "/a": xml }, async (base) => {
      const config = { perSource: 4, perSection: 12, sections: [{ id: "india", label: "India", classify: { dropScopes: ["local"], minImportance: 3, guidance: "G" }, feeds: [{ name: "A", url: `${base}/a` }] }] };
      const r = await build(dir, config, null, { GEMINI_API_KEY: "TOPSECRET", GEMINI_BASE_URL: `http://127.0.0.1:${gemini.address().port}`, SUMMARY_DELAY_MS: "0" });
      assert.equal(r.code, 0);
      const titles = r.news.sections.india.items.map((i) => i.title);
      assert.deepEqual(titles.sort(), ["Parliament passes the national budget", "Unclassified edge case story here"]);
      assert.ok(r.out.includes("AI classification india: cached=0 classified=2 unclassified=1"));
      assert.deepEqual(seenPrompts, ["application/json"]);
      const cache = JSON.parse(await readFile(join(dir, "classify-cache.json"), "utf8"));
      assert.deepEqual(cache["x.example/6"], { scope: "local", importance: 2, topic: "other", focus: "world", clickbait: false, v: 4 });
      assert.ok(!JSON.stringify(r.news).includes("TOPSECRET") && !JSON.stringify(cache).includes("TOPSECRET"));
    });
  } finally { gemini.close(); }
});

test("an item with no description gets the article page's description, without any API key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "daybreak-"));
  const page = "Union home minister said the full implementation of the new criminal laws would speed up cases.";
  const pages = createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(`<html><head><meta property="og:description" content="${page}"></head><body>x</body></html>`); });
  await new Promise((r) => pages.listen(0, "127.0.0.1", r));
  try {
    const link = `http://127.0.0.1:${pages.address().port}/article`;
    const feed = `<rss version="2.0"><channel><item><title>A long headline without any description at all</title><link>${link}</link><pubDate>Sat, 03 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
    await withServer({ "/a": feed }, async (feedBase) => {
      const config = { perSource: 4, perSection: 12, sections: [{ id: "india", label: "India", feeds: [{ name: "A", url: `${feedBase}/a` }] }] };
      const r = await build(dir, config, null, { DESCRIBE_MAX_PER_RUN: "5" });
      assert.equal(r.code, 0);
      assert.equal(r.news.sections.india.items[0].snippet, page);
      assert.ok(r.out.includes("Descriptions: reused=0 fetched=1"));
    });
  } finally { pages.close(); }
});
