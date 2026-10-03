import { ago, feedHtml, statusText, tabsHtml } from "./lib.js";
import { FALLBACK } from "./fallback.js";

const KEY_DATA = "dn-news";
const KEY_TAB = "dn-tab";
const STALE_AFTER_MS = 15 * 60000;
const MIN_SPIN_MS = 700; // a fast response should still visibly acknowledge the tap
const NO_NEWER = "No newer stories yet. Rebuilt about every 30 minutes.";

const tabs = document.getElementById("tabs");
const feed = document.getElementById("feed");
const statusEl = document.getElementById("status");
const announceEl = document.getElementById("announce");
const refreshBtn = document.getElementById("refresh");

let data = FALLBACK;
let mode = "sample"; // "live" | "saved" | "sample"
let note = "";
let loading = false;
let current = "world";

document.getElementById("date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function showStatus() {
  statusEl.textContent = statusText(mode, data.generatedAt, note);
}

function render() {
  const order = data.order ?? Object.keys(data.sections);
  if (!data.sections[current]) current = order[0];
  tabs.innerHTML = tabsHtml(order, data.sections, current);
  feed.innerHTML = feedHtml(data.sections[current].items);
  showStatus();
}

// manual: show progress and say what happened. The page can only fetch the latest published
// build (rebuilt about every 30 minutes); it cannot trigger a rebuild.
async function load(manual) {
  if (loading) return;
  loading = true;
  refreshBtn.disabled = true;
  refreshBtn.classList.add("spin");
  if (manual) { note = ""; statusEl.textContent = "Refreshing…"; }
  const started = Date.now();
  try {
    const res = await fetch("news.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    if (!json?.sections) throw new Error("bad shape");
    const same = mode === "live" && json.generatedAt === data.generatedAt;
    data = json;
    mode = "live";
    if (manual) await new Promise((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - started))));
    note = manual && same ? NO_NEWER : "";
    store(KEY_DATA, JSON.stringify(json));
    render();
    if (manual) announceEl.textContent = same ? NO_NEWER : `News updated ${ago(json.generatedAt)}.`;
  } catch {
    if (manual) {
      note = mode === "live" ? "Couldn't refresh. Check your connection." : "Couldn't refresh. You may be offline.";
      showStatus();
      announceEl.textContent = note;
    }
  } finally {
    loading = false;
    refreshBtn.disabled = false;
    refreshBtn.classList.remove("spin");
  }
}

tabs.addEventListener("click", (e) => {
  const button = e.target.closest(".tab");
  if (!button) return;
  current = button.dataset.c;
  store(KEY_TAB, current);
  render();
  window.scrollTo(0, 0);
});

// Image load errors do not bubble, so listen in the capture phase and fall back to a text-only card.
feed.addEventListener("error", (e) => {
  if (e.target.tagName !== "IMG") return;
  e.target.closest(".story")?.classList.remove("has-img");
  e.target.remove();
}, true);

refreshBtn.addEventListener("click", () => load(true));

// Coming back after a while: refresh quietly if the data is over 15 minutes old.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - Date.parse(data.generatedAt) > STALE_AFTER_MS) load(false);
});
setInterval(showStatus, 60000);

current = recall(KEY_TAB) || "world";
try {
  const saved = JSON.parse(recall(KEY_DATA));
  if (saved?.sections) { data = saved; mode = "saved"; }
} catch { /* unreadable saved copy: keep the sample */ }
render();
load(false);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
