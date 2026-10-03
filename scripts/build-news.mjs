// Fetches every configured feed and writes news.json. A feed that fails keeps its
// items from the previous published news.json, so one dead source never empties a section.
import { readFile, writeFile } from "node:fs/promises";
import { parseFeed, buildSection, storyKeys, urlAllowed, canonicalUrl } from "./news.mjs";
import { geminiCaller, summarizeSections } from "./summarize.mjs";
import { classifyItems, geminiClassifier } from "./classify.mjs";

const config = JSON.parse(await readFile(process.env.FEEDS_CONFIG ?? new URL("./feeds.json", import.meta.url), "utf8"));
const previous = await readFile(process.env.PREVIOUS_NEWS ?? "previous-news.json", "utf8")
  .then(JSON.parse)
  .catch(() => null);

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "DaybreakBot/1.0 (+https://github.com/appuchans/daybreak)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(await res.text(), feed.name).filter((i) => urlAllowed(i.url, feed));
  if (items.length === 0) throw new Error("no valid items");
  return items;
}

// Classification answers from earlier runs (url -> {scope, importance}), so each story is classified once.
const classifyCache = new Map(Object.entries(
  await readFile(process.env.PREVIOUS_CLASSIFY ?? "previous-classify-cache.json", "utf8").then(JSON.parse).catch(() => ({})),
));
const geminiOptions = { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || undefined, baseUrl: process.env.GEMINI_BASE_URL || undefined };
const aiDelayMs = process.env.SUMMARY_DELAY_MS ? Number(process.env.SUMMARY_DELAY_MS) : 4000;
const usedInRun = new Set();

const status = [];
const sections = {};
let failedSections = 0;
// A story belongs to one section only. Sections are built from the last tab to the first, so a
// later (more specific) tab wins: a Flydubai story that is both India and World stays in India.
const placed = new Set();

for (const section of [...config.sections].reverse()) {
  const results = await Promise.all(
    section.feeds.map(async (feed) => {
      try {
        const items = await fetchFeed(feed);
        status.push({ section: section.id, name: feed.name, url: feed.url, ok: true, count: items.length });
        return { feed, items, ok: true };
      } catch (err) {
        status.push({ section: section.id, name: feed.name, url: feed.url, ok: false, error: String(err.message ?? err) });
        console.log(`::warning::${section.id}/${feed.name} failed: ${err.message ?? err}`);
        return { feed, items: [], ok: false };
      }
    }),
  );
  let items = results.flatMap((r) => r.items);
  const failedNames = new Set(results.filter((r) => !r.ok).map((r) => r.feed.name));
  const liveNames = new Set(results.filter((r) => r.ok).map((r) => r.feed.name));
  const carried = (previous?.sections?.[section.id]?.items ?? []).filter((i) => failedNames.has(i.source) && !liveNames.has(i.source));
  items = items.concat(carried);
  const live = results.filter((r) => r.ok).length;
  if (live < 2) console.log(`::warning::${section.id} has only ${live} live source(s)`);
  // Sections with a `classify` setting ask Gemini whether each story belongs. The pool is each source's
  // newest 2 x perSource stories, so removing some still leaves enough to fill the section.
  if (section.classify && process.env.GEMINI_API_KEY) {
    const perSource = new Map();
    items = items
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .filter((i) => {
        const n = perSource.get(i.source) ?? 0;
        perSource.set(i.source, n + 1);
        return n < config.perSource * 2;
      });
    const stats = await classifyItems(items, { guidance: section.classify.guidance, call: geminiClassifier(geminiOptions), cache: classifyCache, delayMs: aiDelayMs });
    for (const i of items) usedInRun.add(canonicalUrl(i.url));
    console.log(`AI classification ${section.id}: cached=${stats.cached} classified=${stats.classified} unclassified=${stats.unclassified}${stats.halted ? ` halted="${stats.halted}"` : ""}`);
  }
  const built = buildSection(items, { ...config, exclude: placed, classify: section.classify });
  for (const item of built) storyKeys(item).forEach((k) => placed.add(k));
  if (built.length === 0) {
    console.log(`::error::${section.id} has no items; refusing to publish an empty section`);
    failedSections++;
  }
  sections[section.id] = { label: section.label, items: built };
}

if (failedSections > 0) process.exit(1);

// Optional AI summaries: off unless GEMINI_API_KEY is set (a repository secret in the workflow).
if (process.env.GEMINI_API_KEY) {
  const call = geminiCaller({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || undefined, baseUrl: process.env.GEMINI_BASE_URL || undefined });
  const stats = await summarizeSections(sections, { call, previous, maxNew: Number(process.env.SUMMARY_MAX_PER_RUN) || 30, delayMs: process.env.SUMMARY_DELAY_MS ? Number(process.env.SUMMARY_DELAY_MS) : 4000 });
  console.log(`AI summaries: reused=${stats.reused} added=${stats.added} skipped=${stats.skipped} failed=${stats.failed}${stats.halted ? ` halted="${stats.halted}"` : ""}`);
} else {
  console.log("AI summaries: off (GEMINI_API_KEY not set)");
}
// Keep only this run's stories in the cache so it cannot grow without bound.
await writeFile("classify-cache.json", JSON.stringify(Object.fromEntries([...classifyCache].filter(([url]) => usedInRun.has(url)))));
await writeFile("news.json", JSON.stringify({ generatedAt: new Date().toISOString(), order: config.sections.map((s) => s.id), sections: Object.fromEntries(config.sections.map((s) => [s.id, sections[s.id]])), feedStatus: status }, null, 1));
console.log(`wrote news.json: ${Object.entries(sections).map(([k, v]) => `${k}=${v.items.length}`).join(" ")}`);
