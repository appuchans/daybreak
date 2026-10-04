// Pure helpers for the page: no DOM access, so they can be unit tested in Node.
// Everything from news.json is untrusted text: it is escaped here, and links/images are
// restricted to http(s)/https before they reach an attribute.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const safeHref = (u) => (/^https?:\/\//i.test(u ?? "") ? u : "#");
export const safeImage = (u) => (/^https:\/\//i.test(u ?? "") ? u : null);

// BBC serves one image at several widths and its feeds list the 240px one, which is soft as a
// full-width lead image. The 976px variant exists at the same path (checked 2026-10-03).
export function heroImage(url) {
  return url.replace(/^(https:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/)\d+\//, "$1976/");
}

// iso: an ISO date string or epoch milliseconds (stories carry publishedAt as a number).
export function ago(iso, now = Date.now()) {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "recently";
  const minutes = Math.max(0, Math.round((now - t) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export function storyHtml(s, lead = false, now = Date.now()) {
  const image = safeImage(s.image);
  const img = image
    ? `<img class="thumb" src="${esc(lead ? heroImage(image) : image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : "";
  const age = Number.isFinite(s.publishedAt) ? `<span class="age"> · ${esc(ago(s.publishedAt, now))}</span>` : "";
  const also = s.alsoReportedBy?.length ? `<div class="also">Also reported by ${esc(s.alsoReportedBy.join(", "))}</div>` : "";
  const snippet = typeof s.aiSummary === "string" && s.aiSummary
    ? `<p><span class="ai-tag">What it's about</span> ${esc(s.aiSummary)}</p>`
    : s.snippet ? `<p>${esc(s.snippet)}</p>` : "";
  return (
    `<a class="story${lead ? " lead" : ""}${img ? " has-img" : ""}" href="${esc(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">` +
    `${img}<div class="txt"><div class="meta">${esc(s.source)}${age}</div><h2>${esc(s.title)}</h2>${snippet}${also}</div></a>`
  );
}

export function tabsHtml(order, sections, current) {
  return order
    .map((id) => `<button class="tab" type="button" aria-pressed="${id === current}" data-c="${esc(id)}">${esc(sections[id].label)}</button>`)
    .join("");
}

export function feedHtml(items, now = Date.now()) {
  return items?.length ? items.map((s, i) => storyHtml(s, i === 0, now)).join("") : '<p class="empty">No stories in this section right now.</p>';
}

// The site is rebuilt every hour at half past (UTC), which keeps the AI features within the free daily
// quota. Keep UPDATE_TIMES_UTC in step with the schedule in .github/workflows/news.yml.
// Past STALE_AFTER_MIN the page says how old the stories are and when newer ones are expected.
export const UPDATE_TIMES_UTC = Array.from({ length: 24 }, (_, h) => h * 60 + 30); // minutes after midnight UTC
export const STALE_AFTER_MIN = 30;
const BUILD_MIN = 10; // a build is published within about this long after its start time

function duration(min) {
  if (min < 60) return `${min} min`;
  const tens = Math.round(min / 10) * 10;
  const h = Math.floor(tens / 60);
  const m = tens % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Start times of the update before and after `now` (ms).
function updateTimes(now) {
  const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const all = [-1, 0, 1].flatMap((d) => UPDATE_TIMES_UTC.map((m) => midnight + d * 86_400_000 + m * 60_000));
  return { last: Math.max(...all.filter((t) => t <= now)), next: Math.min(...all.filter((t) => t > now)) };
}

export function minutesToNextUpdate(now = Date.now()) {
  return Math.round((updateTimes(now).next - now) / 60_000);
}

export function nextUpdateText(min) {
  return min > 5 ? `Next update in about ${duration(min)}.` : "Newer stories are due shortly.";
}

// "" while the stories are fresh; otherwise how old they are and when newer ones are expected.
export function staleText(generatedAt, now = Date.now()) {
  const t = Date.parse(generatedAt);
  if (!Number.isFinite(t) || now - t < STALE_AFTER_MIN * 60_000) return "";
  const { last } = updateTimes(now);
  const late = t < last && now - last > (BUILD_MIN + 20) * 60_000;
  return `These stories are from ${ago(generatedAt, now)}. ${late ? "The latest update is running late." : nextUpdateText(minutesToNextUpdate(now))}`;
}

export function statusText(mode, generatedAt, note = "", now = Date.now()) {
  const when = ago(generatedAt, now);
  const base =
    mode === "live" ? `Updated ${when}`
    : mode === "saved" ? `Showing stories saved ${when}.`
    : `Live news unavailable. Showing sample stories from ${when}.`;
  return note ? `${base} · ${note}` : base;
}

// "News Today": a newspaper-style front page built from the sections' own top stories (no extra data).
export const TODAY = "today";
export const TODAY_LABEL = "News Today";
const PER_SECTION = 3;

// The page follows the tab order: the lead is the first section's top story (World's, normally), and the
// sections follow in tab order. A score across sections put a Sports story above the world news.
export function pickLead(order, sections) {
  const id = order.find((s) => sections[s]?.items?.length);
  return id ? { id, item: sections[id].items[0] } : null;
}

function headlineHtml(s, now) {
  const age = Number.isFinite(s.publishedAt) ? ` · ${esc(ago(s.publishedAt, now))}` : "";
  return `<li><a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener noreferrer"><span class="fp-title">${esc(s.title)}</span><span class="fp-src">${esc(s.source)}${age}</span></a></li>`;
}

export function frontPageHtml(order, sections, now = Date.now()) {
  const lead = pickLead(order, sections);
  if (!lead) return '<p class="empty">No stories right now.</p>';
  const blocks = order
    .filter((id) => sections[id]?.items?.length)
    .map((id) => {
      const items = sections[id].items.filter((s) => s !== lead.item).slice(0, PER_SECTION);
      if (!items.length) return "";
      const [first, ...rest] = items;
      const more = rest.length ? `<ul class="fp-list">${rest.map((s) => headlineHtml(s, now)).join("")}</ul>` : "";
      return `<section class="fp-section"><button class="fp-head" type="button" data-c="${esc(id)}"><span>${esc(sections[id].label)}</span><span class="fp-more">More ›</span></button>${storyHtml(first, false, now)}${more}</section>`;
    })
    .join("");
  return `<div class="fp-lead">${storyHtml(lead.item, true, now)}</div><div class="fp-grid">${blocks}</div>`;
}
