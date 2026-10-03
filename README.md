# Daybreak

Top news on your phone, in six sections: World, US, Tech, India, Business and Health. It is free to use and free to run: no accounts, no ads, no API keys.

**Live:** https://appuchans.github.io/daybreak/

## What you get

- The latest headlines from several publishers in each section, with a short summary and a picture where the publisher provides one. Tapping a story opens it on the publisher's own site.
- A refresh button, and the page refreshes itself when you come back to it after a while.
- Dark and light themes that follow your phone's setting.
- Works offline with the last stories it loaded.
- Updates about every 30 minutes.
- Optional one-sentence AI summaries, labelled as such (see below).

## AI summaries (optional)

When a Gemini API key is set up, new stories get a one-sentence summary written by Google's Gemini model, shown with an "AI summary" label in place of the publisher's own description. Only the public headline and description are sent to Gemini. On Google's free tier, content sent to the API may be used to improve Google's products. A model can get details wrong, so check the story itself before relying on a summary. With no key, or if Gemini is unavailable, the page shows the publisher's own description.

## Put it on your phone's home screen

- **iPhone:** open the link in Safari, tap Share, then Add to Home Screen.
- **Android:** open the link in Chrome, open the menu, then tap Install app.

## How stories are chosen

Each section combines feeds from five to nine news outlets. Stories reported by several outlets come first (the more outlets cover something, the more important it is treated), then each outlet's newest story, so no single outlet fills a section. Anything older than three days is dropped, and a story shows up in one section only. Indian outlets appear in the India section only.

Daybreak keeps just the headline, a one-line summary, the link, the outlet's name and a picture link. The stories belong to their publishers.

## Run your own copy

Daybreak has no server, so your own copy is a fork plus GitHub Pages:

1. Fork this repository (or use it as a template). It must be public to use free GitHub Pages.
2. In your fork, open the Actions tab and enable workflows. GitHub turns them off in forks by default.
3. Open Settings, then Pages, and set the source to **GitHub Actions**.
4. In the Actions tab, run "Build and deploy" once. Your site appears at `https://<your-user>.github.io/<repo-name>/` when it finishes.

After that it updates itself about every 30 minutes. If a source stops working, the run log names it.

To turn on AI summaries, create a free Gemini API key in Google AI Studio and add it to your fork as a repository secret named `GEMINI_API_KEY` (Settings, Secrets and variables, Actions). Remove the secret to turn them off again.

## Choose your own sources

Open `scripts/feeds.json`. Each section lists its feeds as a name and an RSS or Atom link. Add, remove or swap feeds there, commit, and the site rebuilds. Give every section at least two feeds so one outage doesn't empty it.

## Good to know

- GitHub can delay scheduled updates, so the news may be up to an hour behind.
- Pictures load from the publishers' own servers, and a few publishers block that. Those stories show without a picture.
- GitHub pauses scheduled updates on a public repository after 60 days without any activity. Any commit restarts them.
