// Fetches every configured feed and writes news.json. A feed that fails keeps its
// items from the previous published news.json, so one dead source never empties a section.
import { readFile, writeFile } from "node:fs/promises";
import { parseFeed, buildSection, storyKeys } from "./news.mjs";

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
  const items = parseFeed(await res.text(), feed.name);
  if (items.length === 0) throw new Error("no valid items");
  return items;
}

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
  const built = buildSection(items, { ...config, exclude: placed });
  for (const item of built) storyKeys(item).forEach((k) => placed.add(k));
  if (built.length === 0) {
    console.log(`::error::${section.id} has no items; refusing to publish an empty section`);
    failedSections++;
  }
  sections[section.id] = { label: section.label, items: built };
}

if (failedSections > 0) process.exit(1);
await writeFile("news.json", JSON.stringify({ generatedAt: new Date().toISOString(), order: config.sections.map((s) => s.id), sections: Object.fromEntries(config.sections.map((s) => [s.id, sections[s.id]])), feedStatus: status }, null, 1));
console.log(`wrote news.json: ${Object.entries(sections).map(([k, v]) => `${k}=${v.items.length}`).join(" ")}`);
