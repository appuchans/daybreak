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

async function build(dir, config, previous) {
  const cfg = join(dir, "feeds.json");
  await writeFile(cfg, JSON.stringify(config));
  const env = { ...process.env, FEEDS_CONFIG: cfg, PREVIOUS_NEWS: join(dir, "previous-news.json") };
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
