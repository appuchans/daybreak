# Daybreak

Top news for your phone: World, US, Tech, India, Business, Health. Free to run, no servers, no API keys.

A scheduled GitHub Action (`.github/workflows/news.yml`) fetches the RSS feeds in `scripts/feeds.json`, writes `news.json`, and deploys it with `index.html` to GitHub Pages. The page reads `news.json` from its own origin and keeps the last good copy in localStorage.

A story appears in one section only: when several sections carry it, the later tab wins (a Flydubai story in both World and India stays in India) and the earlier tab fills the gap with its next story.

India-based outlets (including their business feeds) feed the India section only, using their India-specific feeds so their international coverage stays out; a test enforces this.

Within a section, stories carried by several sources rank first, then each source's newest story before any source's second one, so no single feed fills the list. Items older than `maxAgeHours` (72) are dropped.

To vet new sources, list them in `scripts/candidates.json` and push: the "Check candidate feeds" workflow prints, per feed, whether it answers, its item count, freshness and image coverage.

## One-time setup
1. Make the repository public.
2. Settings, Pages, Source: **GitHub Actions**.
3. Run the workflow once from the Actions tab (`workflow_dispatch`). Check its log for `::warning::` lines: they name feeds that failed.

## Develop
```
npm ci
npm test
node scripts/build-news.mjs   # writes news.json
```
Serve the folder with any static server to view `index.html`.

See `PLAN.md` for the roadmap. Headlines, one-line snippets and links only; stories belong to their publishers.
