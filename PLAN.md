# Daybreak: enhancement plan

Constraints: no paid services; public repo; sections in order World, US, Tech, India.

## Architecture
Scheduled GitHub Action fetches RSS feeds, writes `news.json`, deploys it with the page to GitHub Pages. The browser reads a same-origin file: no backend, no keys, no CORS.

## Phase 1: live data
- `scripts/feeds.json`: per-section feed list. Candidates (unverified, from memory):
  World: BBC World, Guardian World, Al Jazeera. US: NPR, BBC US & Canada, Guardian US.
  Tech: Ars Technica, The Verge, Guardian Technology. India: The Hindu, Times of India, BBC India.
- `scripts/build-news.mjs`: fetch with per-feed timeout, normalize to
  `{title, snippet, url, source, image, publishedAt}`, dedupe (URL, then normalized title), take top 3-5 per source, interleave by recency; stories in several feeds rank first.
- A failed feed keeps its items from the previous `news.json`; each section needs >= 2 live sources.
- Store only title, one-line snippet, link, source name.
- Workflow: cron every 30 min + manual dispatch, deploy via Pages actions. Page falls back to localStorage, then the embedded snapshot, and shows "updated X ago" / offline.
- First run verifies the feed list (this build environment cannot reach the feeds).

## Phase 2: installable PWA
Manifest, icons, service worker (cache-first shell, stale-while-revalidate for `news.json`).

## Phase 3: reading features
Pull-to-refresh, bookmarks, read state, source filter, text size, thumbnails from feed media tags. localStorage only.

## Phase 4: quality
Split into `src/`; unit tests for normalizer and dedupe; Lighthouse and accessibility pass; CI on PRs.

## Dropped
AI summaries (paid API, no free key storage).

## Known risks
Scheduled runs can be delayed; GitHub disables schedules on a public repo after 60 days without activity; feeds change or disappear (monitored by the per-section minimum check).
