// Pure feed logic: parse, normalize, dedupe, rank. No I/O, so it is unit-testable.
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true });
const SNIPPET_MAX = 160;

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (v && typeof v === "object" ? (v["#text"] ?? "") : (v ?? "")).toString();

// Many feeds escape their text twice (`&amp;#8217;` in the XML), so after the XML parser's single
// decode the text still holds entities. Decode them once more, after tags are stripped so that a
// decoded "&lt;" is never mistaken for markup.
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", bull: "•",
};

export function decodeEntities(s) {
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
    if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

export function cleanText(s) {
  // Block-level tags separate words; inline tags (<b>, <a>, <em>) must not, or "<b>x</b>." becomes "x .".
  const stripped = text(s)
    .replace(/<\/?(?:p|br|div|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|figure|figcaption)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(stripped)
    .replace(/\s+/g, " ")
    .trim();
}

export function snippet(s, max = SNIPPET_MAX) {
  const t = cleanText(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 0) || max).replace(/[,.;:\s]+$/, "") + "…";
}

export function safeUrl(u) {
  try {
    const url = new URL(text(u).trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// Images are hotlinked, so only https URLs are kept: an http image would be blocked as mixed content.
export function safeImageUrl(u) {
  const url = safeUrl(u);
  return url && url.startsWith("https:") ? url : null;
}

// Feeds embed 1x1 tracking pixels as media items (NPR's is named "npr-rss-pixel.png").
const TRACKING_PIXEL = /pixel|tracking|beacon/i;
const IMG_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|$)/i;

// Best image for an item: media:content/thumbnail and enclosures (widest declared first),
// then the first <img> in the item's HTML body.
export function pickImage(r) {
  const cands = [];
  for (const m of [...asArray(r["media:content"]), ...asArray(r["media:thumbnail"]), ...asArray(r.enclosure)]) {
    const url = m?.["@_url"];
    if (!url) continue;
    const type = m["@_type"] ?? "";
    const medium = m["@_medium"] ?? "";
    const imageLike = type.startsWith("image/") || medium === "image" || (!type && !medium && IMG_EXT.test(url));
    if (!imageLike || TRACKING_PIXEL.test(url)) continue;
    cands.push({ url, width: Number(m["@_width"]) || 0 });
  }
  cands.sort((a, b) => b.width - a.width);
  for (const c of cands) {
    const ok = safeImageUrl(c.url);
    if (ok) return ok;
  }
  const html = text(r["content:encoded"]) + text(r.description) + text(r.summary) + text(r.content);
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  return m && !TRACKING_PIXEL.test(m[1]) ? safeImageUrl(m[1]) : null;
}

export function canonicalUrl(u) {
  const url = new URL(u);
  url.hash = "";
  url.search = "";
  return (url.host.toLowerCase() + url.pathname.replace(/\/+$/, "")).replace(/^www\./, "");
}

export function normalizeTitle(t) {
  return cleanText(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function atomLink(link) {
  const links = asArray(link);
  const alt = links.find((l) => l?.["@_rel"] === "alternate") ?? links.find((l) => !l?.["@_rel"]) ?? links[0];
  return typeof alt === "object" ? alt?.["@_href"] : alt;
}

// Returns [{title, snippet, url, source, publishedAt(ms), image|null}]; entries without a title,
// an http(s) link or a parseable date are dropped, not guessed at.
export function parseFeed(xml, source) {
  const doc = parser.parse(xml);
  // RSS 2.0 (rss/channel/item), RSS 1.0 (rdf:RDF/item, e.g. Deutsche Welle) or Atom (feed/entry).
  const rdf = doc?.["rdf:RDF"];
  const isRss = Boolean(doc?.rss || rdf);
  const raw = doc?.rss ? asArray(doc.rss.channel?.item) : rdf ? asArray(rdf.item) : asArray(doc?.feed?.entry);
  const items = [];
  for (const r of raw) {
    const title = cleanText(r.title);
    const url = safeUrl(isRss ? (r.link ?? r.guid) : atomLink(r.link));
    const date = Date.parse(text(r.pubDate ?? r.published ?? r.updated ?? r["dc:date"]));
    if (!title || !url || Number.isNaN(date)) continue;
    items.push({ title, snippet: snippet(r.description ?? r.summary ?? r.content), url, source, publishedAt: date, image: pickImage(r) });
  }
  return items;
}

const STOPWORDS = new Set("the and for with that this from after over into says said will are was were has have its new not but you your why how what who may can than then out off about amid via per his her their them they been being also more most just one two".split(" "));

// Significant words of a headline, lightly stemmed, for recognising the same event worded differently.
export function titleTokens(title) {
  const words = normalizeTitle(title).split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words.map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)));
}

// Strict on purpose: wrongly merging two different stories hides one of them, while a missed match
// only loses a corroboration signal. With at least 5 shared words and 0.6 overlap, "India beat Pakistan in the cricket final" and
// "India beat Malaysia to retain Asian Games gold" stay apart.
export function sameStory(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared >= 5 && shared / (a.size + b.size - shared) >= 0.6;
}

// A feed may keep only some parts of the publisher's site: `only` (the path must match one of
// these patterns) and `exclude` (it must match none). Patterns are regular expressions on the URL path.
export function urlAllowed(url, { only, exclude } = {}) {
  const path = new URL(url).pathname;
  if (only?.length && !only.some((p) => new RegExp(p).test(path))) return false;
  return !exclude?.some((p) => new RegExp(p).test(path));
}

// Roundups, briefings and digests bundle several unrelated stories under one headline, so they cannot be
// ranked, classified or summarized as one story and are skipped. Deliberately specific: "Morning news
// conference" and "wrap up" are ordinary headlines.
const ROUNDUP = new RegExp(
  [
    String.raw`\bnews\s*(?:wrap|round-?up|digest|bulletin|in\s+brief)\b`,
    String.raw`\b(?:evening|morning|afternoon|midday|daily|weekly|weekend)\s+(?:brief(?:ing)?|digest|bulletin|wrap|round-?up|headlines)\b`,
    String.raw`\bheadlines\s+(?:of\s+the\s+day|today)\b`,
    String.raw`\btop\s+(?:news|headlines|stories)\s+(?:of|today|this)\b`,
    String.raw`&\s*more\s*$`,
  ].join("|"),
  "i",
);
export const isRoundup = (title) => ROUNDUP.test(title);

// Each source's newest `limit(source)` stories, newest first. A source with several feeds under one name
// (CNBC's seven section feeds) gets a proportionally larger pool, or its extra feeds would add nothing.
export function trimPool(items, limit) {
  const seen = new Map();
  return [...items]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((i) => {
      const n = seen.get(i.source) ?? 0;
      seen.set(i.source, n + 1);
      return n < limit(i.source);
    });
}

// The keys a story is recognised by across sources and sections: normalized title and canonical URL.
export function storyKeys(item) {
  return [normalizeTitle(item.title), canonicalUrl(item.url)];
}

// items: every item for one section (several feeds may share a source name).
// exclude: Set of storyKeys already placed in a more specific section; those stories are skipped
// before the per-source cap, so the section backfills with the next story instead of shrinking.
// maxAgeHours (with now): items older than that are dropped, so a dead feed cannot fill a section.
// `eventId` (set by the AI grouping step) marks items that report the same event; they merge like exact duplicates.
// Ranking: AI importance plus a bonus for stories several outlets carry, then each source's newest story before
// any source's second story and so on (so a fast feed cannot crowd the others out of the top
// perSection), then newest first.
export function buildSection(items, { perSource = 4, perSection = 12, exclude = new Set(), maxAgeHours, now = Date.now(), classify } = {}) {
  // AI classification (optional): drop stories judged to be of the wrong scope or too minor for this
  // section. Unclassified stories (no key, quota, bad output) are kept.
  const wanted = (it) =>
    !classify ||
    ((!it.scope || !classify.dropScopes?.includes(it.scope)) &&
      (!it.focus || !classify.dropFocus?.includes(it.focus)) &&
      (!it.topic || !classify.keepTopics || classify.keepTopics.includes(it.topic)) &&
      (it.importance === undefined || it.importance >= (classify.minImportance ?? 1)));
  const fresh = items.filter(
    (it) => !isRoundup(it.title) && !storyKeys(it).some((k) => exclude.has(k)) && (maxAgeHours === undefined || now - it.publishedAt <= maxAgeHours * 3_600_000) && wanted(it),
  );
  // Cluster the same story first (exact title/URL, similar wording, or a shared AI eventId), newest first so
  // the newest report represents the cluster. The per-source cap comes after ranking, not before: capping at a
  // source's newest stories would hide its important older ones behind its minor newer ones.
  const taken = new Map();
  const entries = [];
  for (const it of fresh.sort((a, b) => b.publishedAt - a.publishedAt)) {
    const key = normalizeTitle(it.title);
    const urlKey = canonicalUrl(it.url);
    const tokens = titleTokens(it.title);
    const hit = taken.get(key) ?? taken.get(urlKey) ?? entries.find((e) => sameStory(e.tokens, tokens) || (it.eventId && e.item.eventId === it.eventId));
    if (hit) {
      hit.sources.add(it.source);
      if (!hit.item.image && it.image) hit.item = { ...hit.item, image: it.image };
      taken.set(key, hit);
      taken.set(urlKey, hit);
      continue;
    }
    const entry = { item: it, sources: new Set([it.source]), tokens };
    entries.push(entry);
    taken.set(key, entry);
    taken.set(urlKey, entry);
  }
  // Score = AI importance (3 when unrated) plus up to 2 for other outlets carrying the story, plus the
  // section's bonus when the story's topic is one it wants first (`classify.priorityTopics`).
  const topicBonus = (e) => (classify?.priorityTopics?.includes(e.item.topic) ? (classify.priorityBonus ?? 1) : 0);
  const score = (e) => (e.item.importance ?? 3) + Math.min(2, e.sources.size - 1) + topicBonus(e);
  // Ties go to the source whose turn it is: within each source, rank its stories by score then recency, and
  // let every source's best go before any source's second best.
  const bySource = new Map();
  for (const e of entries) bySource.set(e.item.source, [...(bySource.get(e.item.source) ?? []), e]);
  for (const list of bySource.values()) {
    list.sort((a, b) => score(b) - score(a) || b.item.publishedAt - a.item.publishedAt);
    list.forEach((e, i) => (e.sourceRank = i));
  }
  const ordered = entries.sort((a, b) => score(b) - score(a) || a.sourceRank - b.sourceRank || b.item.publishedAt - a.item.publishedAt);
  const picked = [];
  const used = new Map();
  const room = (e) => (used.get(e.item.source) ?? 0) < perSource;
  const take = (e) => { used.set(e.item.source, (used.get(e.item.source) ?? 0) + 1); picked.push(e); };
  for (const e of ordered) {
    if (picked.length >= perSection) break;
    if (room(e)) take(e);
  }
  // Coverage guarantee (`classify.reserve`): at least `count` stories on the listed topics, when that many
  // exist, by swapping them in for the lowest-ranked stories on other topics.
  if (classify?.reserve) {
    const wantedTopic = (e) => classify.reserve.topics.includes(e.item.topic);
    for (const e of ordered) {
      if (picked.filter(wantedTopic).length >= classify.reserve.count) break;
      if (picked.includes(e) || !wantedTopic(e) || !room(e)) continue;
      const victim = [...picked].reverse().find((p) => !wantedTopic(p));
      if (!victim) break;
      picked.splice(picked.indexOf(victim), 1);
      used.set(victim.item.source, used.get(victim.item.source) - 1);
      take(e);
    }
    picked.sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b));
  }
  return picked.map(({ item, sources }) => {
    const { eventId, ...rest } = item; // internal grouping label, not part of the output
    return { ...rest, alsoReportedBy: [...sources].filter((s) => s !== item.source) };
  });
}
