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
- A story appears in one section only; the later tab wins and the earlier tab backfills.
- India-based outlets feed the India section only, through their India-specific feeds. `test/config.test.mjs` fails if one is added elsewhere.
- Feeds that share a `name` count as one source for ranking. RSS 2.0, RSS 1.0 (RDF) and Atom are parsed.

## Vetting a new source

1. Add the feeds to `scripts/candidates.json` as `{"section", "name", "url"}` and push.
2. The "Check candidate feeds" workflow prints, per feed, whether it answers, its item count, freshness, image coverage, and whether any text looks garbled.
3. Add the ones that pass to `scripts/feeds.json`. `npm test` checks that each section has at least two https feeds.

## Known limits

- Indian outlets' India feeds still carry some foreign stories; there is no classifier.
- A publisher image that fails to load makes its card reflow once.
