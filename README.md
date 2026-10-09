# Daybreak

Top news on your phone, in seven sections: World, US, India, Tech, Business, Health and Sports (cricket and football). The India tab and the sports can be changed in the settings. It is free to use and free to run: no accounts, no ads, no API keys.

**Live:** https://mysteriboks.github.io/daybreak/

## What you get

- **Top News**, a front page laid out like a newspaper: the day's biggest story from World, US or India leads, then the top three headlines from every section, in the same order as the tabs. Tap a section's name to open it. The app always opens here.
- The latest headlines from several publishers in each section, with a short summary, how long ago it was published, and a picture where the publisher provides one. Tapping a story opens it on the publisher's own site.
- Dark and light themes that follow your phone's setting.
- Works offline with the last stories it loaded, and on a slow connection shows them after a couple of seconds instead of waiting.
- New stories every hour, at half past. The page also reloads them when you come back to it after a while, and there's a refresh button.
- Optional AI help: a relevance check for the country tabs (US and India), duplicate grouping, and plain "What it's about" lines for clickbait headlines (see below).

## AI features (optional)

With a Gemini API key set up, an AI model does two jobs in the background:

- **Relevance check.** It rates how much each story matters to the tab's readers. In the India tab (or whichever country it is set to), a town's road project, a local crime or a foreign story with no link to that country is dropped, and more important stories rank higher.
- **Duplicate check.** It groups headlines that report the same specific event, however each outlet words them, so one event gets one card that lists the other outlets that covered it. It also recognises different angles of one ongoing story, such as an election, and keeps those to two cards per section.
- **Clickbait helper.** It flags headlines that hide or distort what the story is about (a teaser, a vague phrase, a question left unanswered). Those cards get a one-sentence "What it's about" line, written only from the headline and the publisher's description. Ordinary headlines are left alone, and if the description doesn't make the story clear, no line is added.

Only public headlines and descriptions are sent to Gemini. On Google's free tier, content sent to the API may be used to improve Google's products. A model can get things wrong, so check the story itself before relying on a "What it's about" line. With no key, or if Gemini is unavailable, nothing is dropped and the page shows the publishers' own headlines and descriptions.

## Put it on your phone's home screen

- **iPhone:** open the link in Safari, tap Share, then Add to Home Screen.
- **Android:** open the link in Chrome, open the menu, then tap Install app.

## How stories are chosen

Each section combines feeds from several news outlets. In the US and India sections, government and policy, politics, defense and security, and major incidents come first. In Health, at least five of the twelve cards are research breakthroughs or pharma and drug developments. Sports covers only the sports chosen in the settings (cricket and football to start with): results, tournaments, big transfers and injuries rank above live blogs, opinion, fantasy tips and rumours, and general sports feeds are narrowed to the chosen sports by article address. Hard news ranks above features, opinion and advice columns, and a story several outlets cover moves up (with an AI key, the model rates how much each story matters; without one, only the number of outlets counts). Within the same standing, each outlet's newest story comes first, so no single outlet fills a section, and with an AI key a section shows at most two cards about the same ongoing story (one election, one war), so a big news day can't push out everything else. Stories are from the last 24 hours (48 for Tech and Health, which publish less often); only when a section would otherwise be short do slightly older stories fill the bottom of it. Roundups and briefings that bundle several stories are skipped, and a story shows up in one section only. World leaves out stories that are mainly about the country tabs' domestic affairs (US and India), even when a foreign outlet reported them.

When a publisher's feed leaves out the description, Daybreak reads the one-line preview description from the article page itself. Daybreak keeps just the headline, a one-line summary, the link, the outlet's name and a picture link. The stories belong to their publishers.

## Run your own copy

Daybreak has no server, so your own copy is a fork plus GitHub Pages:

1. Fork this repository (or use it as a template). It must be public to use free GitHub Pages.
2. In your fork, open the Actions tab and enable workflows. GitHub turns them off in forks by default.
3. Open Settings, then Pages, and set the source to **GitHub Actions**.
4. In the Actions tab, run "Build and deploy" once. Your site appears at `https://<your-user>.github.io/<repo-name>/` when it finishes.

After that it updates itself every hour at half past: each run waits for the next update time, then starts it, because GitHub's own scheduler is unreliable on new repositories. To change how often it updates, edit `schedule` in `scripts/config.json` (every 1, 2, 3 or 4 hours, at a chosen minute past the hour, UTC). If a source stops working, the run log names it. If the stories stop changing for more than an hour or two, the chain has stopped: run "Build and deploy" from the Actions tab, or push any commit, to restart it. If an update fails, the run opens an issue titled "News updates are failing" in your fork, and GitHub emails it to you; it closes itself once updates work again. Enable Issues in your fork's settings if they are off.

To turn on the AI features, create a free Gemini API key in Google AI Studio and add it to your fork as a repository secret named `GEMINI_API_KEY` (Settings, Secrets and variables, Actions). Remove the secret to turn them off again.

## Settings and sources

Everything you might want to change is in `scripts/config.json`:

- `schedule`: how often the news updates (`everyHours`: 1 to 4; `minutePast`: the minute past the hour, UTC).
- `perSection`, `perSource`, `perStory`, `maxAgeHours`, `minFill`: cards per section, the most per outlet and per ongoing story, the oldest story allowed (sections can override it), and how many cards a section needs before older stories may fill it.
- `topNews`: the home tab's name and headlines per section. Sections marked `"lead": true` (World, US and India) can supply its lead story.
- `ai`: the Gemini model and how many new "What it's about" lines a build may write.
- `sections`: the tabs, in order, with their feeds and AI rules.

**Switching the India tab to another country.** In its section, change `id`, `label` and `region` (the country's name, for example `"the United Kingdom"`), replace its `feeds` with that country's news feeds, and rewrite its `guidance` for that country. The World tab and the AI pick up the change by themselves: World then leaves out that country's domestic news instead of India's. A tab can also be about a topic instead of a country: leave out `region`, and describe the topic in `guidance`.

**Choosing sports.** In the Sports section, `sports` lists up to five sports by name. Ready to use: `cricket`, `football` (soccer), `tennis`, `formula1`, `nfl`, `nba`, `mlb` and `nhl`. Their feeds are under `sportFeeds`; another sport needs an entry there with at least two feeds.

Commit a change and the site rebuilds with it.

To change sources, open `scripts/config.json`. Each section lists its feeds as a name and an RSS or Atom link. Add, remove or swap feeds there, commit, and the site rebuilds. Give every section at least two feeds so one outage doesn't empty it. If every feed in a section fails at once, that section keeps showing its last published stories while the others update.

## Good to know

- The refresh button fetches the newest stories that have been prepared; new ones are prepared every hour.
- Pictures load from the publishers' own servers, and a few publishers block that. Those stories show without a picture.
