// Fills in missing descriptions. Some feeds (Times of India's, for one) send none, which leaves a long
// headline with nothing under it. The article page carries a one-line description for link previews
// (og:description); read it for just those stories. Fails open: any problem leaves the snippet empty.
import { cleanText, canonicalUrl, normalizeTitle, snippet } from "./news.mjs";

export const MIN_DESCRIPTION = 40;
const USER_AGENT = "DaybreakBot/1.0 (+https://github.com/appuchans/daybreak)";

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
  return out;
}

// The page's own description, most specific first: og:description, twitter:description, name=description
// (the last is often cut short, so it is the fallback).
export function metaDescription(html) {
  const found = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (a.content && ["og:description", "twitter:description", "description"].includes(key)) found[key] ??= a.content;
  }
  const raw = found["og:description"] ?? found["twitter:description"] ?? found.description;
  return raw ? cleanText(raw) : null;
}

// Reads at most maxBytes of the page (the <head> is at the top), so a 350 KB article costs little.
export async function fetchDescription(url, { fetchImpl = fetch, timeoutMs = 8000, maxBytes = 150_000 } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  let html = "";
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    html = Buffer.concat(chunks).toString("utf8");
    if (/<\/head>/i.test(html)) break;
  }
  await reader.cancel().catch(() => {});
  return metaDescription(html);
}

// Mutates items in place. Earlier answers are reused from the previously published news.json, and at most
// `maxPerRun` pages are fetched per build, one at a time.
export async function enrichSnippets(sections, { previous, fetchDesc = fetchDescription, maxPerRun = 30, delayMs = 300, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const earlier = new Map();
  for (const section of Object.values(previous?.sections ?? {})) {
    for (const it of section.items ?? []) if ((it.snippet ?? "").length >= MIN_DESCRIPTION) earlier.set(canonicalUrl(it.url), it.snippet);
  }
  const stats = { reused: 0, fetched: 0, failed: 0, skipped: 0 };
  const filled = [];
  let calls = 0;
  for (const section of Object.values(sections)) {
    for (const it of section.items) {
      if ((it.snippet ?? "").length >= MIN_DESCRIPTION) continue;
      const old = earlier.get(canonicalUrl(it.url));
      if (old) { it.snippet = old; stats.reused++; continue; }
      if (calls >= maxPerRun) { stats.skipped++; continue; }
      if (calls > 0) await sleep(delayMs);
      calls++;
      try {
        const text = await fetchDesc(it.url);
        if (text && text.length >= MIN_DESCRIPTION && normalizeTitle(text) !== normalizeTitle(it.title) && !normalizeTitle(text).startsWith(normalizeTitle(it.title))) {
          it.snippet = snippet(text);
          filled.push(it);
          stats.fetched++;
        } else stats.failed++;
      } catch (err) {
        stats.failed++;
        if (stats.failed <= 3) log(`::warning::description fetch failed for ${it.source}: ${err?.message ?? err}`);
      }
    }
  }
  // The same description on different stories is the site's boilerplate, not the story's.
  const counts = new Map();
  for (const it of filled) counts.set(it.snippet, (counts.get(it.snippet) ?? 0) + 1);
  for (const it of filled) if (counts.get(it.snippet) > 1) { it.snippet = ""; stats.fetched--; stats.failed++; }
  return stats;
}
