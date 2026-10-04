import { ago, feedHtml, frontPageHtml, minutesToNextUpdate, nextUpdateText, staleText, statusText, tabsHtml, TODAY, TODAY_LABEL } from "./lib.js";
import { FALLBACK } from "./fallback.js";

const KEY_DATA = "dn-news";
const STALE_AFTER_MS = 15 * 60000;
const MIN_SPIN_MS = 700; // a fast response should still visibly acknowledge the tap

const tabs = document.getElementById("tabs");
const feed = document.getElementById("feed");
const statusEl = document.getElementById("status");
const announceEl = document.getElementById("announce");
const refreshBtn = document.getElementById("refresh");
const staleEl = document.getElementById("stale");
const staleMsg = document.getElementById("stale-text");

let data = FALLBACK;
let mode = "sample"; // "live" | "saved" | "sample"
let note = "";
let loading = false;
let current = TODAY;

document.getElementById("date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function showStatus() {
  statusEl.textContent = statusText(mode, data.generatedAt, note);
  const stale = staleText(data.generatedAt);
  staleEl.hidden = !stale;
  staleMsg.textContent = stale;
}

function render() {
  const order = data.order ?? Object.keys(data.sections);
  // Fall back to the first tab for display only, so a saved tab the sample or an older copy lacks (Sports)
  // is still selected once the live stories arrive.
  const shown = current === TODAY || data.sections[current] ? current : TODAY;
  tabs.innerHTML = tabsHtml([TODAY, ...order], { [TODAY]: { label: TODAY_LABEL }, ...data.sections }, shown);
  feed.innerHTML = shown === TODAY ? frontPageHtml(order, data.sections) : feedHtml(data.sections[shown].items);
  document.body.dataset.view = shown === TODAY ? "today" : "section";
  // Seven tabs overflow a phone screen: keep the selected one in view (Sports sits off-screen on the right).
  tabs.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  showStatus();
}

// manual: show progress and say what happened. The page can only fetch the latest published
// build (rebuilt every hour); it cannot trigger a rebuild.
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
    const noNewer = `No newer stories yet. ${nextUpdateText(minutesToNextUpdate())}`;
    note = manual && same ? noNewer : "";
    store(KEY_DATA, JSON.stringify(json));
    render();
    if (manual) announceEl.textContent = same ? noNewer : `News updated ${ago(json.generatedAt)}.`;
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

function openTab(id) {
  current = id;
  render();
  window.scrollTo(0, 0);
}

tabs.addEventListener("click", (e) => {
  const button = e.target.closest(".tab");
  if (button) openTab(button.dataset.c);
});

// News Today: a section's heading opens that section's tab.
feed.addEventListener("click", (e) => {
  const head = e.target.closest(".fp-head");
  if (head) openTab(head.dataset.c);
});

// Image load errors do not bubble, so listen in the capture phase and fall back to a text-only card.
feed.addEventListener("error", (e) => {
  if (e.target.tagName !== "IMG") return;
  e.target.closest(".story, .fp-list a")?.classList.remove("has-img");
  e.target.remove();
}, true);

refreshBtn.addEventListener("click", () => load(true));
document.getElementById("stale-refresh").addEventListener("click", () => load(true));

// Coming back after a while: refresh quietly if the data is over 15 minutes old.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - Date.parse(data.generatedAt) > STALE_AFTER_MS) load(false);
});
setInterval(showStatus, 60000);

// The app always opens on News Today; the chosen tab is not remembered between visits.
try {
  const saved = JSON.parse(recall(KEY_DATA));
  if (saved?.sections) { data = saved; mode = "saved"; }
} catch { /* unreadable saved copy: keep the sample */ }
render();
load(false);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
