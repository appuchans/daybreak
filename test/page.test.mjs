import { test } from "node:test";
import assert from "node:assert/strict";
import { esc, safeHref, safeImage, ago, heroImage, storyHtml, tabsHtml, feedHtml, statusText, staleText, nextUpdateText, nextUpdateIn } from "../site/lib.js";

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

test("staleText: silent under 30 minutes, then says how old the stories are and when the next update is due", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const at = (min) => new Date(now - min * 60000).toISOString();
  assert.equal(staleText(at(10), now), "");
  assert.equal(staleText(at(45), now), "These stories are from 45 min ago. Next update in about 1 h 20 min.");
  assert.equal(staleText(at(100), now), "These stories are from 2 h ago. Next update in about 20 min.");
  assert.equal(staleText(at(118), now), "These stories are from 2 h ago. Newer stories are due shortly.");
  assert.equal(staleText(at(200), now), "These stories are from 3 h ago. An update is overdue.");
  assert.equal(staleText("not a date", now), "");
  assert.equal(nextUpdateIn(at(30), now), 90);
  assert.equal(nextUpdateText(90), "Next update in about 1 h 30 min.");
  assert.equal(nextUpdateText(118), "Next update in about 2 h.");
});
