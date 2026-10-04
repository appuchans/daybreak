import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, safeHref, safeImage, ago, heroImage, storyHtml, tabsHtml, feedHtml, statusText, pickLead, frontPageHtml, settingsOf } from "../site/lib.js";

test("esc escapes the five HTML-significant characters", () => {
  assert.equal(esc(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(esc(null), "");
});

test("links must be http(s); images must be https", () => {
  assert.equal(safeHref("javascript:alert(1)"), "#");
  assert.equal(safeHref("https://a.example/x"), "https://a.example/x");
  assert.equal(safeImage("http://a.example/x.jpg"), null);
  assert.equal(safeImage("data:image/png;base64,AAAA"), null);
  assert.equal(safeImage("https://a.example/x.jpg"), "https://a.example/x.jpg");
});

test("storyHtml escapes feed text and neutralizes hostile URLs", () => {
  const html = storyHtml({ title: `<img src=x onerror=alert(1)>`, snippet: `"quoted" & <b>`, url: "javascript:alert(1)", source: "<S>", image: "http://evil.example/x.jpg", alsoReportedBy: ["A<"] });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes('href="#"'));
  assert.ok(!html.includes("evil.example"));
  assert.ok(!html.includes("has-img"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("Also reported by A&lt;"));
});

test("storyHtml marks the lead and image cards", () => {
  const html = storyHtml({ title: "T", url: "https://a.example/1", source: "S", image: "https://i.example/p.jpg" }, true);
  assert.ok(html.includes('class="story lead has-img"'));
  assert.ok(html.includes('class="thumb" src="https://i.example/p.jpg"'));
  assert.ok(html.includes('referrerpolicy="no-referrer"'));
});

test("the lead image upgrades BBC thumbnails; other cards keep the small one", () => {
  const bbc = "https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/554e/live/x.jpg";
  assert.equal(heroImage(bbc), "https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/554e/live/x.jpg");
  assert.equal(heroImage("https://i.guim.co.uk/img/a.jpg?width=700"), "https://i.guim.co.uk/img/a.jpg?width=700");
  const card = { title: "T", url: "https://a.example/1", source: "S", image: bbc };
  assert.ok(storyHtml(card, true).includes("/ace/standard/976/"));
  assert.ok(storyHtml(card, false).includes("/ace/standard/240/"));
});

test("ago formats minutes, hours and days, and survives a bad date", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  assert.equal(ago("2026-10-03T11:59:00Z", now), "just now");
  assert.equal(ago("2026-10-03T11:15:00Z", now), "45 min ago");
  assert.equal(ago("2026-10-03T07:00:00Z", now), "5 h ago");
  assert.equal(ago("2026-09-28T12:00:00Z", now), "5 days ago");
  assert.equal(ago("not a date", now), "recently");
});

test("tabsHtml marks the current tab; feedHtml shows an empty state", () => {
  const tabs = tabsHtml(["a", "b"], { a: { label: "A" }, b: { label: "B" } }, "b");
  assert.ok(tabs.includes('aria-pressed="true" data-c="b"'));
  assert.ok(tabs.includes('aria-pressed="false" data-c="a"'));
  assert.ok(feedHtml([]).includes("No stories in this section"));
});

test("statusText covers live, saved, sample and notes", () => {
  const now = Date.parse("2026-10-03T12:30:00Z");
  const at = "2026-10-03T12:00:00Z";
  assert.equal(statusText("live", at, "", now), "Updated 30 min ago");
  assert.equal(statusText("live", at, "No newer stories yet.", now), "Updated 30 min ago · No newer stories yet.");
  assert.equal(statusText("saved", at, "", now), "Showing stories saved 30 min ago.");
  assert.ok(statusText("sample", at, "", now).startsWith("Live news unavailable."));
});

test("a what-it-is-about line replaces the snippet, is labelled, and is escaped", () => {
  const html = storyHtml({ title: "T", snippet: "Feed snippet.", aiSummary: `Kim <script>x</script> & co`, url: "https://a.example/1", source: "S" });
  assert.ok(html.includes(`<span class="ai-tag">What it's about</span> Kim &lt;script&gt;x&lt;/script&gt; &amp; co`));
  assert.ok(!html.includes("Feed snippet."));
  assert.ok(storyHtml({ title: "T", snippet: "Feed snippet.", url: "https://a.example/1", source: "S" }).includes("Feed snippet."));
});

test("cards show how long ago the story was published", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const html = storyHtml({ title: "T", url: "https://a.example/1", source: "BBC", publishedAt: now - 2 * 3_600_000 }, false, now);
  assert.ok(html.includes('<div class="meta">BBC<span class="age"> · 2 h ago</span></div>'));
  assert.ok(!storyHtml({ title: "T", url: "https://a.example/1", source: "BBC" }).includes("class=\"age\""), "no age without a date");
  assert.equal(ago(now - 45 * 60_000, now), "45 min ago");
});

test("Top News: the lead is the biggest World/US/India top story, never a soft section's, and is not repeated", () => {
  const s = (title, extra = {}) => ({ title, url: `https://a.example/${encodeURIComponent(title)}`, source: "S", alsoReportedBy: [], ...extra });
  const sections = {
    world: { label: "World", items: [s("W1", { importance: 4 }), s("W2", { image: "https://i.example/w2.jpg" }), s("W3"), s("W4"), s("W5")] },
    us: { label: "US", items: [s("U1", { importance: 4, alsoReportedBy: ["A", "B"] }), s("U2")] },
    tech: { label: "Tech", items: [] },
    sports: { label: "Sports", items: [s("S1", { importance: 5, alsoReportedBy: ["A", "B"] })] },
  };
  const order = ["world", "us", "tech", "sports"];
  assert.equal(pickLead(order, sections).item.title, "U1", "more outlets beats World's top story");
  assert.equal(pickLead(["world", "us"], { world: sections.world, us: { label: "US", items: [s("U1", { importance: 4 })] } }).item.title, "W1", "ties go to the earlier tab");
  assert.equal(pickLead(["sports"], { sports: sections.sports }).item.title, "S1", "a soft section leads only when nothing else exists");
  const html = frontPageHtml(order, sections);
  assert.equal(html.split(">U1<").length - 1, 1, "lead shown once");
  assert.ok(html.includes(">W1<") && html.includes(">W3<") && !html.includes(">W4<"), "World digest: its top three");
  assert.ok(html.indexOf('data-c="world"') < html.indexOf('data-c="us"') && html.indexOf('data-c="us"') < html.indexOf('data-c="sports"'), "sections in tab order");
  assert.ok(!html.includes('data-c="tech"'), "empty sections are left out");
  assert.ok(!html.includes("w2.jpg"), "only a section's first headline gets a picture");
  assert.equal(frontPageHtml([], {}), '<p class="empty">No stories right now.</p>');
});

test("Top News escapes feed text and neutralizes hostile links", () => {
  const evil = { title: "<script>x</script>", url: "javascript:alert(1)", source: "<b>", alsoReportedBy: [] };
  const html = frontPageHtml(["world"], { world: { label: "<i>W</i>", items: [{ ...evil, title: "Lead" }, evil, evil] } });
  assert.ok(!html.includes("<script>") && !html.includes("<b>") && !html.includes("<i>W"));
  assert.ok(!html.includes("javascript:"));
});

test("Top News settings from news.json apply; missing ones fall back to defaults", () => {
  const s = settingsOf({ settings: { topNews: { label: "Front", headlinesPerSection: 1 } } });
  assert.deepEqual(s.topNews.leadSections, ["world", "us", "india"], "unset keys keep their defaults");
  assert.equal(s.topNews.label, "Front");
  const html = frontPageHtml(["world"], { world: { label: "World", items: [1, 2, 3].map((n) => ({ title: `W${n}`, url: `https://a.example/${n}`, source: "S", alsoReportedBy: [] })) } }, Date.now(), s.topNews);
  assert.ok(html.includes(">W2<") && !html.includes(">W3<"), "one headline per section");
  assert.deepEqual(settingsOf({}), settingsOf({ settings: {} }));
});
