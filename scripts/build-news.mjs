// Fetches every configured feed and writes news.json. A feed that fails keeps its
// items from the previous published news.json, so one dead source never empties a section.
import { readFile, writeFile } from "node:fs/promises";
import { parseFeed, buildSection, storyKeys, urlAllowed, canonicalUrl, trimPool } from "./news.mjs";
import { geminiCaller, summarizeSections } from "./summarize.mjs";
import { classifyItems, geminiClassifier } from "./classify.mjs";
import { enrichSnippets } from "./describe.mjs";
import { groupEvents, geminiGrouper } from "./group.mjs";

const config = JSON.parse(await readFile(process.env.CONFIG_FILE ?? new URL("./config.json", import.meta.url), "utf8"));
const previous = await readFile(process.env.PREVIOUS_NEWS ?? "previous-news.json", "utf8")
  .then(JSON.parse)
  .catch(() => null);

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "DaybreakBot/1.0 (+https://github.com/mysteriboks/daybreak)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const items = parseFeed(await res.text(), feed.name).filter((i) => urlAllowed(i.url, feed));
  if (items.length === 0) throw new Error("no valid items");
  return items;
}

// Classification answers from earlier runs ("section|url" -> {scope, importance, ...}), so each story is
// classified once per section.
const classifyCache = new Map(Object.entries(
  await readFile(process.env.PREVIOUS_CLASSIFY ?? "previous-classify-cache.json", "utf8").then(JSON.parse).catch(() => ({})),
));
// Settings come from config.json; the environment variables override them (for tests and one-off runs).
const geminiOptions = { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || config.ai?.model || undefined, baseUrl: process.env.GEMINI_BASE_URL || undefined };
// Extra spacing between AI steps; the per-minute limit itself is enforced in gemini.mjs for every call.
const aiDelayMs = process.env.SUMMARY_DELAY_MS ? Number(process.env.SUMMARY_DELAY_MS) : 0;
const usedInRun = new Set();

const MIN_FILL = config.minFill ?? 8;
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
  // Freshness: stories older than the section's maxAgeHours (default the global one) are left out, unless
  // the section would be short (under MIN_FILL cards); then older stories, up to twice that age, fill the
  // remaining places below the fresh ones.
  const maxAgeHours = section.maxAgeHours ?? config.maxAgeHours;
  const sectionOptions = { ...config, maxAgeHours, classify: section.classify ?? { minImportance: 2 } };
  let items = results.flatMap((r) => r.items);
  const failedNames = new Set(results.filter((r) => !r.ok).map((r) => r.feed.name));
  const liveNames = new Set(results.filter((r) => r.ok).map((r) => r.feed.name));
  const carried = (previous?.sections?.[section.id]?.items ?? []).filter((i) => failedNames.has(i.source) && !liveNames.has(i.source));
  // Stories a later tab already shows are removed before anything else, so they neither use up a source's
  // candidate slots below nor cost classification calls.
  items = items.concat(carried).filter((i) => !storyKeys(i).some((k) => placed.has(k)));
  const live = results.filter((r) => r.ok).length;
  if (live < 2) console.log(`::warning::${section.id} has only ${live} live source(s)`);
  // With a key, Gemini rates every story (scope, importance, clickbait). Only sections with a `classify`
  // setting drop stories on that basis. The pool is each source's newest 2 x perSource stories, so
  // removing some still leaves enough to fill the section.
  if (process.env.GEMINI_API_KEY) {
    const feedsPerName = new Map();
    for (const f of section.feeds) feedsPerName.set(f.name, (feedsPerName.get(f.name) ?? 0) + 1);
    items = trimPool(items, (name) => config.perSource * 2 * Math.min(feedsPerName.get(name) ?? 1, 4));
    const key = (it) => `${section.id}|${canonicalUrl(it.url)}`;
    const stats = await classifyItems(items, { key, guidance: section.classify?.guidance ?? `These items were collected for the ${section.label} section of a news app. Rate scope and importance for a general reader of that section.`, call: geminiClassifier(geminiOptions), cache: classifyCache, delayMs: aiDelayMs });
    for (const i of items) usedInRun.add(key(i));
    // Group headlines that report the same event, among the stories likely to be shown (the provisional top
    // 2 x perSection), so one event takes one card. Not cached: the groups depend on what else is in the pool.
    if (!stats.halted) {
      const provisional = new Set(buildSection(items, { ...sectionOptions, maxAgeHours: maxAgeHours && maxAgeHours * 2, perSection: config.perSection * 2, exclude: placed }).map((i) => i.url));
      if (aiDelayMs > 0) await new Promise((r) => setTimeout(r, aiDelayMs));
      const g = await groupEvents(items.filter((i) => provisional.has(i.url)), { call: geminiGrouper(geminiOptions) });
      console.log(`AI grouping ${section.id}: groups=${g.groups} grouped=${g.grouped} stories=${g.stories}${g.halted ? ` halted="${g.halted}"` : ""}`);
    }
    console.log(`AI classification ${section.id}: cached=${stats.cached} classified=${stats.classified} unclassified=${stats.unclassified}${stats.halted ? ` halted="${stats.halted}"` : ""}`);
  }
  let built = buildSection(items, { ...sectionOptions, exclude: placed });
  if (maxAgeHours && built.length < MIN_FILL) {
    const shown = new Set([...placed, ...built.flatMap(storyKeys)]);
    const older = buildSection(items, { ...sectionOptions, maxAgeHours: maxAgeHours * 2, exclude: shown, perSection: config.perSection - built.length });
    if (older.length) console.log(`${section.id}: ${built.length} stories within ${maxAgeHours} h; ${older.length} older ones fill the rest`);
    built = built.concat(older);
  }
  // An empty section (every feed down, or everything filtered out) keeps its previously published stories
  // rather than holding back every other section's update. With no earlier copy, the build fails.
  if (built.length === 0) {
    built = (previous?.sections?.[section.id]?.items ?? []).filter((i) => !storyKeys(i).some((k) => placed.has(k)));
    if (built.length > 0) console.log(`::warning::${section.id} has no new items; keeping its ${built.length} previously published stories`);
    else {
      console.log(`::error::${section.id} has no items and no earlier copy; refusing to publish an empty section`);
      failedSections++;
    }
  }
  for (const item of built) storyKeys(item).forEach((k) => placed.add(k));
  sections[section.id] = { label: section.label, items: built };
}

if (failedSections > 0) process.exit(1);

// Missing descriptions are read from the article pages (no key needed), before summaries use them.
{
  const stats = await enrichSnippets(sections, { previous, maxPerRun: process.env.DESCRIBE_MAX_PER_RUN ? Number(process.env.DESCRIBE_MAX_PER_RUN) : 30 });
  console.log(`Descriptions: reused=${stats.reused} fetched=${stats.fetched} failed=${stats.failed} skipped=${stats.skipped}`);
}

// Optional AI summaries: off unless GEMINI_API_KEY is set (a repository secret in the workflow).
if (process.env.GEMINI_API_KEY) {
  const call = geminiCaller(geminiOptions);
  const stats = await summarizeSections(sections, { call, previous, maxNew: Number(process.env.SUMMARY_MAX_PER_RUN) || config.ai?.summariesPerRun || 10, delayMs: aiDelayMs });
  console.log(`AI summaries: reused=${stats.reused} added=${stats.added} skipped=${stats.skipped} failed=${stats.failed}${stats.halted ? ` halted="${stats.halted}"` : ""}`);
} else {
  console.log("AI summaries: off (GEMINI_API_KEY not set)");
}
// Keep only this run's stories in the cache so it cannot grow without bound.
await writeFile("classify-cache.json", JSON.stringify(Object.fromEntries([...classifyCache].filter(([url]) => usedInRun.has(url)))));
// The page's own settings travel with the stories, so the page needs no code change when they do.
const settings = { topNews: config.topNews };
await writeFile("news.json", JSON.stringify({ generatedAt: new Date().toISOString(), settings, order: config.sections.map((s) => s.id), sections: Object.fromEntries(config.sections.map((s) => [s.id, sections[s.id]])), feedStatus: status }, null, 1));
console.log(`wrote news.json: ${Object.entries(sections).map(([k, v]) => `${k}=${v.items.length}`).join(" ")}`);
