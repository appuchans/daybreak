# Daybreak

A phone-friendly news page: World, US, Tech, India, Business and Health. It costs nothing to run: no server, no API keys, no paid services.

Live: https://appuchans.github.io/daybreak/

## How it works

A GitHub Action (`.github/workflows/news.yml`) runs about every 30 minutes and on every push to `main`. It runs the tests, fetches the RSS feeds listed in `scripts/feeds.json`, writes `news.json`, and deploys it with the static page in `site/` to GitHub Pages. The page reads `news.json` from its own origin, so there is no backend and no CORS problem.

How stories are chosen, per section:
- A feed that fails keeps its previous stories, and one that returns nothing is reported as a warning in the Action log. A section with no stories at all blocks the deploy, so a broken build never replaces a good site.
- Stories carried by several sources rank first. After that, each source's newest story comes before any source's second story, so one fast feed cannot fill the list.
- Items older than 72 hours (`maxAgeHours`) are dropped.
- A story appears in one section only. When two sections carry it, the later tab wins and the earlier tab fills the gap with its next story.
- India-based outlets, including their business feeds, feed the India section only. They use their India-specific feeds, and a test fails if one is added to another section.
- Only the headline, a one-line snippet, the link, the source name and an image URL are stored. Stories belong to their publishers.

## The page

- Refresh button, plus a quiet refresh when you return to the page after 15 minutes. The button fetches the latest published `news.json`; it cannot trigger a rebuild.
- Installable as an app (Add to Home Screen) and usable offline with the last stories it loaded.
- Thumbnails come straight from the publishers (https only). If one fails to load, the card falls back to text.
- Follows the system light or dark theme.

## Repository layout

```
site/       index.html, app.css, app.js (DOM), lib.js (pure rendering helpers), fallback.js,
            sw.js (service worker), manifest.webmanifest, icons/
scripts/    feeds.json (sources), news.mjs (parse, dedupe, rank), build-news.mjs (writes news.json),
            check-feeds.mjs + candidates.json (vet new sources)
test/       node:test suites for scripts/ and site/lib.js
.github/    news.yml (build and deploy), ci.yml (tests on PRs and non-main branches),
            check-feeds.yml (vets scripts/candidates.json when it changes)
PLAN.md     status and roadmap
```

## Run your own copy

Daybreak has no server, so your own copy is a fork plus GitHub Pages:

1. Fork this repository (or use it as a template). It must be public to use free GitHub Pages.
2. In your fork, open the Actions tab and enable workflows. GitHub turns them off in forks by default.
3. Open Settings, then Pages, and set the source to **GitHub Actions**.
4. In the Actions tab, run "Build and deploy" once. Your site appears at `https://<your-user>.github.io/<repo-name>/` when it finishes.

After that it updates itself about every 30 minutes. If a feed stops working, the run log shows a `::warning::` line naming it. Edit `scripts/feeds.json` to change the sources (see below).

## Develop

```
npm ci
npm test                       # 36 tests
node scripts/build-news.mjs    # fetches the feeds and writes news.json
cp news.json site/ && cd site && python3 -m http.server 8000
```

## Add or change a source

1. List the feeds in `scripts/candidates.json` as `{"section", "name", "url"}`, then push. The "Check candidate feeds" workflow prints, for each one, whether it answers, how many items it returns, how fresh the newest is, what share has images, and whether any text looks garbled.
2. Add the ones that pass to the right section in `scripts/feeds.json`. Feeds that share a `name` count as one source for ranking.
3. `npm test` checks that every section has at least two https feeds and that India-based feeds stay in India.

RSS 2.0, RSS 1.0 (RDF) and Atom are supported.

## Known limits

- Scheduled runs can be delayed by GitHub, and GitHub disables schedules on a public repo after 60 days with no activity. Any push resets that.
- Images are hotlinked: the publisher sees the request, and some block it.
- Indian outlets' India feeds still carry some foreign stories; there is no classifier.

Remaining ideas (bookmarks, read state, source filter, text size) are in `PLAN.md`.
