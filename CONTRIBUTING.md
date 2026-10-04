# Developing Daybreak

Status and roadmap are in `PLAN.md`.

**Rule: every change that users or forkers can notice also updates `README.md` in the same commit** (sections, sources, ranking, refresh and update behaviour, setup). Developer detail goes here, not in the README.

## News Today (front page)

`frontPageHtml` in `site/lib.js`, drawn from the published sections with no build or AI step. The lead is the strongest section top story by the build's own weighting (importance, 3 when unrated, plus up to 2 for other outlets), ties to the earlier tab; each section then shows its top three, skipping the lead. It is the first tab (`TODAY`) and the default view. Added 2026-10-04 as one commit so it can be reverted if the newspaper style doesn't work out.

## Offline shell and fonts

`site/sw.js` serves the app's own files cache-first and refreshes them in the background (a deploy shows on the next open), and `news.json` network-first with the cached copy as fallback. Bump `CACHE` when the precached file list changes. The two fonts are bundled as variable woff2 files (latin and latin-ext subsets, downloaded from Google Fonts 2026-10-04) so the page makes no third-party request and keeps its fonts offline; only the latin files are precached.

## Rebuild schedule

GitHub's `schedule` trigger has never fired for this repository, so `news.yml` chains itself: after a deploy, the `next` job waits until the next half hour (UTC) and dispatches the workflow again with the built-in token (`workflow_dispatch` is one of the two events that token may trigger). `always()` keeps the chain alive through a failed build. Every push starts a chain too; the `next-run` concurrency group (cancel-in-progress) cancels the older waiting job, so one chain survives. Builds share a `build` concurrency group with cancel-in-progress, so a newer build (a push) replaces an older one still running: overlapping builds doubled the Gemini calls and once let the older build deploy last. The deploy lock (`pages` group) sits on the deploy job, not the workflow, so the waiting job doesn't block pushes. The cron line (same times) is kept as a backup. Hourly because each build makes about 10 Gemini calls (seven grouping requests plus new classifications and summaries): about 240 of the 500 a day, leaving room for pushes and re-ratings. Every 30 minutes would come to about 480 and leave none; a 27-minute loop once made 500 to 650. A build's worst case is about 20 (new summaries are capped at 10 per run, `SUMMARY_MAX_PER_RUN`). Pushes still build immediately. The page's stale notice (`staleText` in `site/lib.js`) uses `UPDATE_TIMES_UTC`, so change it together with the workflow's times. To restart a broken chain, push or run the workflow by hand.

## Layout

```
site/       index.html, app.css, app.js (DOM), lib.js (pure rendering helpers), fallback.js,
            sw.js (service worker), manifest.webmanifest, icons/, fonts/ (Fraunces and Public Sans, SIL OFL, from Google Fonts)
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
- Ranking: score = AI importance (3 if unrated) + 1 for each other outlet carrying the story (at most +2) + `priorityBonus` when the story's `topic` is in the section's `priorityTopics` (US and India: policy, politics, defense, incident, +2, so an Iran-war story outranks a clinical-trial feature even if the model rates both 4 or 5). Ties go to the source whose turn it is (within a source, its best story by score before its second best), then to the newest story. `perSource` caps how many one source can place and is applied after ranking, so a source's important older stories are not hidden behind its minor newer ones. Without a key everything scores 3 plus the outlet bonus, which reproduces the old corroboration-first order. Items older than `maxAgeHours` (72) are dropped.
- Importance is approximated by corroboration: stories several outlets carry rank first. Matching is exact on title or URL, or fuzzy (`sameStory`: at least 5 shared significant words and 60% overlap). It is strict on purpose, because a wrong merge hides a story while a miss only loses a signal.
- A feed can keep only part of a publisher's site with `only` / `exclude` (regular expressions on the URL path) in `feeds.json`. The India section uses them: The Hindu drops its city and state folders, NDTV and HT keep `/india-news/`, Times of India keeps `/india/`, BusinessLine drops `/news/world/`. Use the vetting workflow's per-feed "where" list (`india-news:12 cities:5`) to find the paths.
- Roundups, briefings and digests ("Evening news wrap: … & more", "Morning briefing") bundle unrelated stories, so `isRoundup` in `news.mjs` skips them by headline pattern. The patterns are deliberately specific; add one there if a new format slips through.
- A story appears in one section only; the later tab wins and the earlier tab backfills.
- India-based outlets feed the India section only, through their India-specific feeds. `test/config.test.mjs` fails if one is added elsewhere.
- Feeds that share a `name` count as one source for ranking. RSS 2.0, RSS 1.0 (RDF) and Atom are parsed.

## Missing descriptions

`scripts/describe.mjs`, no API key needed. Some feeds send an empty description (Times of India's, for one), which left a long headline with nothing under it. For the published stories whose snippet is under 40 characters, the build reads the article page's `og:description` (then `twitter:description`, then `name=description`, which is often truncated).

- Only the top of the page is read (stops at `</head>`, at most 150 KB), one page at a time, 300 ms apart, at most 30 pages per build (`DESCRIBE_MAX_PER_RUN`), with a `DaybreakBot` user agent that links to this repository.
- Earlier answers are reused from the previously published `news.json`. A description that is short, copies the headline, or repeats across different stories (site boilerplate) is discarded.
- Fails open: a blocked page, timeout or missing tag leaves the snippet empty. The log line `Descriptions: reused=… fetched=… failed=… skipped=…` shows how it went. `robots.txt` is not consulted; this is the same single request a link preview makes for a page the card already links to.

## AI classification (Gemini)

`scripts/classify.mjs`, run for every section when `GEMINI_API_KEY` is set. Gemini rates each candidate headline's `scope` (national, state, local, international), `importance` (1 to 5), `topic` (policy, politics, defense, incident, economy, other), `focus` (us, india or world: whose domestic affairs the story is mainly about, whichever outlet reported it) and `clickbait` (true when the headline hides or distorts what the story is about). With a key every section is rated (sections without a `classify` block use a generic guidance text and drop nothing); in a section with a `classify` block, the section's `guidance` text applies, `dropScopes` and `minImportance` decide what is removed, and `importance` drives the ranking in every section (see below). The World section sets `dropFocus: ["us", "india"]` and `dropScopes: ["state", "local"]` (a story about one US state such as California, or one city, is domestic news), so US- or India-domestic stories reported by foreign outlets belong to those sections, not World; wars and diplomacy involving the US or India stay. Every section also drops importance 1 (trivial or promotional). The rubric in the system prompt scores features, opinion, advice columns and human-interest stories at 2 at most; bump `CACHE_VERSION` in `classify.mjs` when it changes so cached answers are asked again.

- The pool is each source's newest 2 x `perSource` stories, in batches of 40 per request, so removing stories still leaves enough to fill the section.
- Answers are cached by section and canonical URL (`"world|bbc.com/news/…"`) in `classify-cache.json`, which the workflow publishes next to `news.json` and fetches again on the next run, so each story is classified once per section. The key includes the section because each section rates against its own guidance: a story Health rates 1 can be a 5 for World. The page never reads that file.
- Stories a later tab already shows are removed from an earlier tab's candidates before the pool is trimmed and classified, so they neither take a source's candidate slots nor cost calls.
- Fail-open: no key, a quota error or unparseable output leaves stories unclassified, and unclassified stories are kept. The first `HaltGemini` error stops the run's remaining calls.
- Rate limits: the free tier allows 15 requests a minute and 500 a day (AI Studio, 2026-10-04). A normal build makes about 10 calls, so the hourly builds use about 240 a day; a change to `CACHE_VERSION` or the cache key re-rates every story once (about 15 more). `generate()` in `scripts/gemini.mjs` spaces every Gemini call in the build (classification, grouping, summaries) at least 5 s apart (`GEMINI_MIN_INTERVAL_MS`), and retries a 429 twice, after Google's suggested `RetryInfo` delay or 30 s (`GEMINI_RETRY_DELAY_MS`), before halting. A 429 that persists is the daily quota.
- Model replies are validated (known scope, integer importance 1 to 5, id in range); headlines are passed to the model as data inside a JSON array.
- `scripts/gemini.mjs` holds the one REST call used by classification and summaries.

## AI event grouping (Gemini)

`scripts/group.mjs`. Word-overlap matching cannot tell that "Medical transport airplane missing off Massachusetts" and "Coast Guard searching off Nantucket for missing Boston-bound jet" are one event. After classification, each section's provisional top 2 x `perSection` stories go to Gemini in one request; it returns groups of ids that report the same specific event (not the same broad topic: two strikes in one war are two events). Grouped items get a shared `eventId`, which `buildSection` treats like an exact duplicate: one card, every outlet credited in `alsoReportedBy`, and the corroboration bonus applies.

- One extra request per section per run, not cached (a group depends on what else is in the pool). Skipped if classification halted.
- Fail-open: errors are a `::warning::`, nothing is grouped, and the deterministic matching still applies. `eventId` never reaches `news.json`.

## AI "what it's about" lines (Gemini)

`scripts/summarize.mjs`, called from `build-news.mjs`. Off unless the `GEMINI_API_KEY` secret exists.

- Model `gemini-3.5-flash-lite` (override with `GEMINI_MODEL`), `generateContent` REST call via `scripts/gemini.mjs`, key in the `x-goog-api-key` header.
- Summaries come from the headline and feed description only, one sentence; descriptions under 40 characters are skipped.
- Only stories the classifier flagged `clickbait` are summarized, and the line is labelled "What it's about" on the page. The prompt tells the model to say what the story is about using only the headline and description, or to answer `SKIP` when the description does not make that clear. Earlier summaries of non-clickbait stories are not reused.
- Each story is summarized once: earlier summaries are reused by canonical URL from the previously published `news.json`.
- Free-tier limits are only visible in the AI Studio account, so each run makes at most `SUMMARY_MAX_PER_RUN` (10) new calls, lead stories first, paced by `generate()` (see the rate limit above). A persistent HTTP 429, and 400/401/403/404, stop the run's calls (a warning in the log); three failures in a row do too. The build never fails because of summaries.
- Roll back: delete the secret (summaries vanish on the next build), or `git revert` the commit that added them.
- Not verified against the live API from the development sandbox, which has no key; check the "AI summaries: ..." line in the build log after the first run.

## Vetting a new source

1. Add the feeds to `scripts/candidates.json` as `{"section", "name", "url"}` and push.
2. The "Check candidate feeds" workflow prints, per feed, whether it answers, its item count, freshness, image coverage, and whether any text looks garbled.
3. Add the ones that pass to `scripts/feeds.json`. `npm test` checks that each section has at least two https feeds.

## Business sources (vetted 2026-10-03)

Used: NYT Business and Economy, CNBC (top news, business, finance, earnings, energy, investing, world business), BBC, Guardian, NPR, MarketWatch top stories. The Business section requires the AI topic `economy` and importance 3 or more, which removes the personal-finance, lifestyle and misfiled stories those feeds also carry. Rejected after vetting: WSJ Markets / US Business and MarketWatch real-time / market-pulse (their feeds stopped updating about 20 months ago), Yahoo Finance (stale), Business Insider (lifestyle), Forbes (contributor blogs), Fortune (career features), The Economist (weekly), Axios and Al Jazeera (general news). NYT links may be paywalled for readers even though the feed is free.

## Health sources (vetted 2026-10-03)

Health is meant to cover research and pharma as well as health news. Sources: BBC, NPR, KFF Health News, STAT; pharma and biotech (BioPharma Dive, GEN, FDA press announcements); research (Medical Xpress, News-Medical, ScienceDaily health and pharmacology, MedPage Today, Nature, Nature Medicine, The Lancet, NEJM). The classifier labels stories `research` or `pharma`, `classify.reserve` guarantees at least 5 of the 12 cards on them when that many exist (a ranking bonus on top pushed it to 11 of 12 and crowded out public-health news, so `priorityBonus` is 0); wellness and lifestyle stories score 2 and are dropped. Journal feeds (Lancet, NEJM, Nature Medicine) are tables of contents with paper-style titles. Rejected: Fierce Pharma and Fierce Biotech (no parseable items), Endpoints and NIH (403), EurekAlert and the FDA drug-approvals feed (404), Guardian and BBC science (too general).

## Known limits

- Indian outlets' feeds are filtered by URL section only, so a regional or foreign story filed under a national section still gets through; there is no classifier. Mint was dropped because its company and economy feeds are mostly global news.
- A publisher image that fails to load makes its card reflow once.

## Sports sources

Sports is cricket and football only. Vetted 2026-10-04: ESPNcricinfo (no images), BBC Cricket and Football, Guardian Cricket and Football, The Hindu Cricket and Football, Hindustan Times Cricket, NDTV Sports (cricket), CBS Sports Soccer and talkSPORT (football path only). Dead, blocked or stale: ESPN soccer, Sky Sports (both), Goal, Cricbuzz, Indian Express (403), Times of India cricket (stale since 2016), Fox Sports soccer (stale). Multi-sport feeds are narrowed with `only` patterns. Indian outlets are allowed in this section only (see the config test). There is no cricket/football minimum yet; if one sport crowds out the other, add topics for them to the classifier and a `reserve`.
