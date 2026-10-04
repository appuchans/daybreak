# Daybreak: plan and status

Constraints: no paid services; public repo; sections in order World, US, India, Tech, Business, Health, Sports (cricket and football only).

## Architecture
A scheduled GitHub Action fetches RSS feeds (`scripts/feeds.json`), writes `news.json`, and deploys it with the static page in `site/` to GitHub Pages. The browser reads a same-origin file: no backend, no keys, no CORS.

```
scripts/   feeds.json, news.mjs (pure parse/rank), build-news.mjs (I/O), check-feeds.mjs (vetting)
site/      index.html, app.css, app.js (DOM), lib.js (pure, unit tested), fallback.js, sw.js, manifest, icons
test/      node:test suites for scripts/ and site/lib.js
.github/   news.yml (build + deploy, twice a day at 00:30 and 12:30 UTC, and on push to main), ci.yml (PRs and non-main branches),
           check-feeds.yml (vets scripts/candidates.json when it changes)
```

## Built
- Phase 1, live data: 6 sections, 5 to 10 feeds each; per-feed failure keeps that source's previous items; a section with no items blocks the deploy.
- Ranking: stories carried by several sources first, then each source's newest before any source's second; items older than 72 h dropped; a story appears in one section only (later tab wins).
- India-based outlets feed the India section only, via India-specific feeds (enforced by a test).
- Entities that feeds escape twice are decoded; RSS 2.0, RSS 1.0/RDF (Deutsche Welle) and Atom are parsed.
- Phase 2, PWA: manifest, icons, network-first service worker, offline fallback to the last saved news.
- Thumbnails (hotlinked https only; tracking pixels ignored; BBC lead image upgraded to 976 px).
- Refresh button and quiet refresh when the page is reopened after 15 minutes.
- Phase 4: page split into modules with unit-tested rendering; CI on PRs; axe and Lighthouse pass
  (accessibility 100, SEO 100, best practices 96, performance 90 in a sandbox that blocks fonts and image hosts).

## Remaining (Phase 3, reading features; localStorage only)
Bookmarks, read state, source filter, text size, and optionally a pull-to-refresh gesture.

## AI for background work (Gemini free tier)
Classification (India section): Gemini judges scope and importance of each candidate headline so local, state and foreign stories are dropped; chosen because URL rules cannot tell a small-town railway bridge from national news. Built 2026-10-03; judge it by reading the India tab over a few days.

## AI summaries became a clickbait helper (2026-10-03)
Summarizing every story mostly restated the headline, so summaries are now written only for headlines the classifier flags as clickbait, labelled "What it's about". Judge by reading a few days of flagged cards: are the flags right, and does the line say something the headline hid?

## Earlier trial: AI summaries for every story (Gemini free tier)
Built 2026-10-03, off until a `GEMINI_API_KEY` secret exists. Keep if the summaries prove useful; otherwise remove the secret or revert the commit. Questions to answer from the trial: are one-sentence summaries of a feed snippet better than the snippet, does the free tier cover ~30 new stories per 30 minutes, and are summaries accurate.

## Dropped
Summaries from full article text (needs scraping publishers: paywalls, terms of service, copyright).

## Known risks
- Scheduled runs can be delayed, and GitHub disables schedules on a public repo after 60 days without activity (any push resets it).
- Feeds change or disappear; the per-feed warning in the Actions log and the vetting workflow are the detection.
- Images are hotlinked: publishers see the request, some block hotlinking (the card falls back to text), and a failed image shifts the layout once.
- Indian outlets' India feeds still carry some foreign stories; there is no classifier.
