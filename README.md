# Daybreak

Top news on your phone, in seven sections: World, US, India, Tech, Business, Health and Sports (cricket and football only). It is free to use and free to run: no accounts, no ads, no API keys.

**Live:** https://mysteriboks.github.io/daybreak/

## What you get

- The latest headlines from several publishers in each section, with a short summary and a picture where the publisher provides one. Tapping a story opens it on the publisher's own site.
- A refresh button, and the page refreshes itself when you come back to it after a while.
- Dark and light themes that follow your phone's setting.
- Works offline with the last stories it loaded.
- Updates about every 30 minutes.
- Optional AI help: a relevance check for the India section and plain "What it's about" lines for clickbait headlines (see below).

## AI features (optional)

With a Gemini API key set up, an AI model does two jobs in the background:

- **Relevance check for the India section.** It reads each candidate headline and judges whether it matters to readers across India. A town's road project, a local crime or a foreign story with no India link is dropped, and more important stories rank higher.
- **Duplicate check.** It groups headlines that report the same specific event, however each outlet words them, so one event gets one card that lists the other outlets that covered it.
- **Clickbait helper.** It flags headlines that hide or distort what the story is about (a teaser, a vague phrase, a question left unanswered). Those cards get a one-sentence "What it's about" line, written only from the headline and the publisher's description. Ordinary headlines are left alone, and if the description doesn't make the story clear, no line is added.

Only public headlines and descriptions are sent to Gemini. On Google's free tier, content sent to the API may be used to improve Google's products. A model can get things wrong, so check the story itself before relying on a "What it's about" line. With no key, or if Gemini is unavailable, nothing is dropped and the page shows the publishers' own headlines and descriptions.

## Put it on your phone's home screen

- **iPhone:** open the link in Safari, tap Share, then Add to Home Screen.
- **Android:** open the link in Chrome, open the menu, then tap Install app.

## How stories are chosen

Each section combines feeds from five to nine news outlets. In the US and India sections, government and policy, politics, defense and security, and major incidents come first. In Health, at least five of the twelve cards are research breakthroughs or pharma and drug developments. Hard news ranks above features, opinion and advice columns, and a story several outlets cover moves up (with an AI key, the model rates how much each story matters; without one, only the number of outlets counts). Within the same standing, each outlet's newest story comes first, so no single outlet fills a section. Anything older than three days is dropped, roundups and briefings that bundle several stories are skipped, and a story shows up in one section only. Indian outlets appear in the India section only, and World leaves out stories that are mainly about US or Indian domestic affairs, even when a foreign outlet reported them.

When a publisher's feed leaves out the description, Daybreak reads the one-line preview description from the article page itself. Daybreak keeps just the headline, a one-line summary, the link, the outlet's name and a picture link. The stories belong to their publishers.

## Run your own copy

Daybreak has no server, so your own copy is a fork plus GitHub Pages:

1. Fork this repository (or use it as a template). It must be public to use free GitHub Pages.
2. In your fork, open the Actions tab and enable workflows. GitHub turns them off in forks by default.
3. Open Settings, then Pages, and set the source to **GitHub Actions**.
4. In the Actions tab, run "Build and deploy" once. Your site appears at `https://<your-user>.github.io/<repo-name>/` when it finishes.

After that it updates itself about every 30 minutes. If a source stops working, the run log names it.

To turn on the AI features, create a free Gemini API key in Google AI Studio and add it to your fork as a repository secret named `GEMINI_API_KEY` (Settings, Secrets and variables, Actions). Remove the secret to turn them off again.

## Choose your own sources

Open `scripts/feeds.json`. Each section lists its feeds as a name and an RSS or Atom link. Add, remove or swap feeds there, commit, and the site rebuilds. Give every section at least two feeds so one outage doesn't empty it.

## Good to know

- GitHub can delay scheduled updates, so the news may be up to an hour behind.
- Pictures load from the publishers' own servers, and a few publishers block that. Those stories show without a picture.
- GitHub pauses scheduled updates on a public repository after 60 days without any activity. Any commit restarts them.
