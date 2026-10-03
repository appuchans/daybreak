// Pure feed logic: parse, normalize, dedupe, rank. No I/O, so it is unit-testable.
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true });
const SNIPPET_MAX = 160;

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (v && typeof v === "object" ? (v["#text"] ?? "") : (v ?? "")).toString();

export function cleanText(s) {
  return text(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
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
  const raw = doc?.rss ? asArray(doc.rss.channel?.item) : asArray(doc?.feed?.entry);
  const items = [];
  for (const r of raw) {
    const title = cleanText(r.title);
    const url = safeUrl(doc.rss ? (r.link ?? r.guid) : atomLink(r.link));
    const date = Date.parse(text(r.pubDate ?? r.published ?? r.updated ?? r["dc:date"]));
    if (!title || !url || Number.isNaN(date)) continue;
    items.push({ title, snippet: snippet(r.description ?? r.summary ?? r.content), url, source, publishedAt: date, image: pickImage(r) });
  }
  return items;
}

// itemsBySource: Map<sourceName, item[]> (several feeds may share a name; they are merged).
// Ranking: stories carried by more than one source first, then newest first.
export function buildSection(items, { perSource = 4, perSection = 12 } = {}) {
  const taken = new Map();
  const bySource = new Map();
  for (const it of [...items].sort((a, b) => b.publishedAt - a.publishedAt)) {
    const n = bySource.get(it.source) ?? 0;
    if (n >= perSource) continue;
    bySource.set(it.source, n + 1);
    const key = normalizeTitle(it.title);
    const urlKey = canonicalUrl(it.url);
    const hit = taken.get(key) ?? taken.get(urlKey);
    if (hit) {
      hit.sources.add(it.source);
      if (!hit.item.image && it.image) hit.item = { ...hit.item, image: it.image };
      taken.set(key, hit);
      taken.set(urlKey, hit);
      continue;
    }
    const entry = { item: it, sources: new Set([it.source]) };
    taken.set(key, entry);
    taken.set(urlKey, entry);
  }
  return [...new Set(taken.values())]
    .sort((a, b) => b.sources.size - a.sources.size || b.item.publishedAt - a.item.publishedAt)
    .slice(0, perSection)
    .map(({ item, sources }) => ({ ...item, alsoReportedBy: [...sources].filter((s) => s !== item.source) }));
}
