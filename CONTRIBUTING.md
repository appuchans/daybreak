# Developing Daybreak

Status and roadmap are in `PLAN.md`.

## Layout

```
site/       index.html, app.css, app.js (DOM), lib.js (pure rendering helpers), fallback.js,
            sw.js (service worker), manifest.webmanifest, icons/
scripts/    feeds.json (sources), news.mjs (parse, dedupe, rank), build-news.mjs (writes news.json),
            check-feeds.mjs + candidates.json (vet new sources)
test/       node:test suites for scripts/ and site/lib.js
.github/    news.yml (build and deploy), ci.yml (tests on PRs and non-main branches),
            check-feeds.yml (vets scripts/candidates.json when it changes)
```

## Run locally

```
npm ci
npm test                       # 36 tests
node scripts/build-news.mjs    # fetches the feeds and writes news.json
cp news.json site/ && cd site && python3 -m http.server 8000
```

## How the build works

- A feed that fails keeps its previous stories; one that returns nothing is a `::warning::` in the run log. A section with no stories blocks the deploy, so a broken build never replaces a good site.
- Ranking: stories carried by several sources first, then each source's newest before any source's second, then newest first. Items older than `maxAgeHours` (72) are dropped.
- Importance is approximated by corroboration: stories several outlets carry rank first. Matching is exact on title or URL, or fuzzy (`sameStory`: at least 5 shared significant words and 60% overlap). It is strict on purpose, because a wrong merge hides a story while a miss only loses a signal.
- A feed can keep only part of a publisher's site with `only` / `exclude` (regular expressions on the URL path) in `feeds.json`. The India section uses them: The Hindu drops its city and state folders, NDTV and HT keep `/india-news/`, Times of India keeps `/india/`, BusinessLine drops `/news/world/`. Use the vetting workflow's per-feed "where" list (`india-news:12 cities:5`) to find the paths.
- A story appears in one section only; the later tab wins and the earlier tab backfills.
- India-based outlets feed the India section only, through their India-specific feeds. `test/config.test.mjs` fails if one is added elsewhere.
- Feeds that share a `name` count as one source for ranking. RSS 2.0, RSS 1.0 (RDF) and Atom are parsed.

## AI summaries (Gemini)

`scripts/summarize.mjs`, called from `build-news.mjs`. Off unless the `GEMINI_API_KEY` secret exists.

- Model `gemini-3.5-flash-lite` (override with `GEMINI_MODEL`), `generateContent` REST call, key in the `x-goog-api-key` header.
- Summaries come from the headline and feed description only, one sentence; descriptions under 60 characters are skipped, and the model may answer `SKIP`.
- Each story is summarized once: earlier summaries are reused by canonical URL from the previously published `news.json`.
- Free-tier limits are only visible in the AI Studio account, so each run makes at most `SUMMARY_MAX_PER_RUN` (30) new calls, lead stories first, 4 s apart (`SUMMARY_DELAY_MS`). HTTP 429/400/401/403 stop the run's calls (a warning in the log); three failures in a row do too. The build never fails because of summaries.
- Roll back: delete the secret (summaries vanish on the next build), or `git revert` the commit that added them.
- Not verified against the live API from the development sandbox, which has no key; check the "AI summaries: ..." line in the build log after the first run.

## Vetting a new source

1. Add the feeds to `scripts/candidates.json` as `{"section", "name", "url"}` and push.
2. The "Check candidate feeds" workflow prints, per feed, whether it answers, its item count, freshness, image coverage, and whether any text looks garbled.
3. Add the ones that pass to `scripts/feeds.json`. `npm test` checks that each section has at least two https feeds.

## Known limits

- Indian outlets' feeds are filtered by URL section only, so a regional or foreign story filed under a national section still gets through; there is no classifier. Mint was dropped because its company and economy feeds are mostly global news.
- A publisher image that fails to load makes its card reflow once.
