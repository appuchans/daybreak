import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, buildSection, snippet, safeUrl, canonicalUrl, normalizeTitle } from "../scripts/news.mjs";

const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Quake hits coast &amp; city</title><link>https://a.example/news/1?utm=x</link>
<description>&lt;p&gt;A strong   quake struck.&lt;/p&gt;</description><pubDate>Sat, 03 Oct 2026 08:00:00 GMT</pubDate></item>
<item><title>No date item</title><link>https://a.example/2</link></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Sat, 03 Oct 2026 07:00:00 GMT</pubDate></item>
</channel></rss>`;

const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom story</title><link rel="alternate" href="https://b.example/x"/><link rel="self" href="https://b.example/self"/>
<summary>Short summary</summary><updated>2026-10-03T09:00:00Z</updated></entry></feed>`;

test("parses RSS, decodes entities, strips markup, drops invalid entries", () => {
  const items = parseFeed(rss, "A");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Quake hits coast & city");
  assert.equal(items[0].snippet, "A strong quake struck.");
});

test("parses Atom and prefers the alternate link", () => {
  const [item] = parseFeed(atom, "B");
  assert.equal(item.url, "https://b.example/x");
  assert.equal(item.publishedAt, Date.parse("2026-10-03T09:00:00Z"));
});

test("safeUrl admits only http(s)", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("not a url"), null);
  assert.ok(safeUrl("https://x.example/a"));
});

test("snippet truncates at a word boundary", () => {
  const s = snippet("word ".repeat(100), 20);
  assert.ok(s.length <= 21 && s.endsWith("…"));
});

test("canonicalUrl ignores query, hash, www and trailing slash", () => {
  assert.equal(canonicalUrl("https://www.x.example/a/?u=1#h"), canonicalUrl("https://x.example/a"));
});

const it = (source, title, url, minute) => ({ title, snippet: "", url, source, publishedAt: Date.UTC(2026, 9, 3, 10, minute) });

test("dedupes by title across sources and ranks multi-source stories first", () => {
  const out = buildSection([
    it("A", "Big event: latest", "https://a.example/1", 5),
    it("B", "Big Event Latest!", "https://b.example/9", 1),
    it("A", "Newer solo story", "https://a.example/2", 30),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Big event: latest");
  assert.deepEqual(out[0].alsoReportedBy, ["B"]);
});

test("dedupes by canonical URL when titles differ", () => {
  const out = buildSection([
    it("A", "Headline one", "https://x.example/p?ref=a", 1),
    it("B", "Different headline", "https://x.example/p", 2),
  ]);
  assert.equal(out.length, 1);
});

test("caps items per source and per section", () => {
  const items = Array.from({ length: 10 }, (_, i) => it("A", `Story ${i}`, `https://a.example/${i}`, i));
  assert.equal(buildSection(items, { perSource: 4, perSection: 12 }).length, 4);
  const many = ["A", "B", "C", "D"].flatMap((s) => Array.from({ length: 4 }, (_, i) => it(s, `${s} story ${i}`, `https://${s}.example/${i}`, i)));
  assert.equal(buildSection(many, { perSource: 4, perSection: 12 }).length, 12);
});

test("normalizeTitle is case, punctuation and whitespace insensitive", () => {
  assert.equal(normalizeTitle("  Hello,   WORLD! "), "hello world");
});

const withMedia = (inner) => `<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item>
<title>T</title><link>https://a.example/1</link><pubDate>Sat, 03 Oct 2026 08:00:00 GMT</pubDate>${inner}</item></channel></rss>`;

test("picks the widest https media image", () => {
  const [i] = parseFeed(withMedia(`<media:thumbnail url="https://i.example/small.jpg" width="240"/><media:thumbnail url="https://i.example/big.jpg" width="976"/>`), "A");
  assert.equal(i.image, "https://i.example/big.jpg");
});

test("reads image enclosures and ignores non-image enclosures", () => {
  assert.equal(parseFeed(withMedia(`<enclosure url="https://i.example/p.jpg" type="image/jpeg"/>`), "A")[0].image, "https://i.example/p.jpg");
  assert.equal(parseFeed(withMedia(`<enclosure url="https://i.example/a.mp3" type="audio/mpeg"/>`), "A")[0].image, null);
});

test("falls back to the first <img> in the item body", () => {
  const xml = withMedia(`<description><![CDATA[<p><img src="https://i.example/in-body.png" alt=""/>text</p>]]></description>`);
  assert.equal(parseFeed(xml, "A")[0].image, "https://i.example/in-body.png");
});

test("drops http and non-http(s) images", () => {
  assert.equal(parseFeed(withMedia(`<media:thumbnail url="http://i.example/x.jpg" width="100"/>`), "A")[0].image, null);
  assert.equal(parseFeed(withMedia(`<media:thumbnail url="javascript:alert(1)" width="100"/>`), "A")[0].image, null);
});

test("a duplicate story inherits an image from another source", () => {
  const a = { title: "Same story", snippet: "", url: "https://a.example/1", source: "A", publishedAt: 2, image: null };
  const b = { title: "Same story", snippet: "", url: "https://b.example/1", source: "B", publishedAt: 1, image: "https://i.example/b.jpg" };
  assert.equal(buildSection([a, b])[0].image, "https://i.example/b.jpg");
});

test("ignores tracking pixels in media and in body", () => {
  const px = "https://media.npr.org/include/images/tracking/npr-rss-pixel.png?story=1";
  assert.equal(parseFeed(withMedia(`<media:content url="${px}" medium="image"/>`), "A")[0].image, null);
  assert.equal(parseFeed(withMedia(`<description><![CDATA[<img src="${px}"/>]]></description>`), "A")[0].image, null);
});

test("exclude skips stories placed elsewhere and backfills from the rest", () => {
  const items = [
    it("A", "Shared story", "https://a.example/shared", 9),
    it("A", "Story two", "https://a.example/2", 8),
    it("A", "Story three", "https://a.example/3", 7),
  ];
  const out = buildSection(items, { perSource: 2, exclude: new Set([normalizeTitle("Shared story")]) });
  assert.deepEqual(out.map((i) => i.title), ["Story two", "Story three"]);
  const byUrl = buildSection(items, { exclude: new Set([canonicalUrl("https://a.example/shared")]) });
  assert.equal(byUrl.length, 2);
});
