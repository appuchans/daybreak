import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, buildSection, snippet, safeUrl, canonicalUrl, normalizeTitle, cleanText, urlAllowed, sameStory, titleTokens, isRoundup, isJournalChatter, trimPool } from "../scripts/news.mjs";

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

test("each source's newest story outranks another source's second story", () => {
  const items = [
    it("A", "A one", "https://a.example/1", 50), it("A", "A two", "https://a.example/2", 49), it("A", "A three", "https://a.example/3", 48),
    it("B", "B one", "https://b.example/1", 10),
  ];
  const titles = buildSection(items, { perSection: 2 }).map((i) => i.title);
  assert.deepEqual(titles.sort(), ["A one", "B one"]);
});

test("maxAgeHours drops stale items", () => {
  const now = Date.UTC(2026, 9, 3, 12, 0);
  const old = { ...it("A", "Old", "https://a.example/old", 0), publishedAt: now - 100 * 3_600_000 };
  const recent = { ...it("A", "Recent", "https://a.example/new", 0), publishedAt: now - 2 * 3_600_000 };
  assert.deepEqual(buildSection([old, recent], { maxAgeHours: 72, now }).map((i) => i.title), ["Recent"]);
  assert.equal(buildSection([old, recent], { now }).length, 2);
});

test("decodes entities that survive the XML parser (double-escaped feeds)", () => {
  const xml = `<rss version="2.0"><channel>
<item><title>Don&amp;#8217;t panic: Kim&amp;#039;s &amp;amp; Jo&amp;#x2019;s &amp;quot;plan&amp;quot;</title><link>https://a.example/1</link><pubDate>Sat, 03 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>`;
  assert.equal(parseFeed(xml, "A")[0].title, `Don’t panic: Kim's & Jo’s "plan"`);
});

test("entity decoding leaves unknown entities and invalid code points alone", () => {
  assert.equal(cleanText("a &bogus; b &#0; c &#xD800; d &#1114112;"), "a &bogus; b &#0; c &#xD800; d &#1114112;");
});

test("a decoded &lt; is text, not markup", () => {
  assert.equal(cleanText("1 &lt; 2 and 3 &gt; 2"), "1 < 2 and 3 > 2");
});

test("parses RSS 1.0 / RDF feeds (Deutsche Welle)", () => {
  const xml = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://dw.example"><title>DW</title></channel>
<item rdf:about="https://dw.example/a"><title>RDF story</title><link>https://dw.example/a</link><description>Body &lt;b&gt;text&lt;/b&gt;</description><dc:date>2026-10-03T08:00:00Z</dc:date></item></rdf:RDF>`;
  const [item] = parseFeed(xml, "DW");
  assert.equal(item.title, "RDF story");
  assert.equal(item.url, "https://dw.example/a");
  assert.equal(item.snippet, "Body text");
});

test("inline tags do not split words or detach punctuation; block tags separate words", () => {
  assert.equal(cleanText("Kim <b>fired</b>. A<a href='x'>BC</a>D"), "Kim fired. ABCD");
  assert.equal(cleanText("<p>One</p><p>Two</p>line<br>break"), "One Two line break");
});

test("urlAllowed: `only` must match, `exclude` must not", () => {
  const rules = { only: ["^/india-news/"], exclude: ["^/india-news/cities/"] };
  assert.ok(urlAllowed("https://x.example/india-news/a-story-1", rules));
  assert.ok(!urlAllowed("https://x.example/world-news/a-story-1", rules));
  assert.ok(!urlAllowed("https://x.example/india-news/cities/a-story-1", rules));
  assert.ok(urlAllowed("https://x.example/anything", {}));
});

const story = (title, source, minute = 0) => ({ title, snippet: "", url: `https://${source}.example/${encodeURIComponent(title)}`, source, publishedAt: Date.UTC(2026, 9, 3, 10, minute) });

test("sameStory matches one event worded differently, and keeps different events apart", () => {
  const same = (a, b) => sameStory(titleTokens(a), titleTokens(b));
  assert.ok(same("Trump says Iran war will end 'very soon'", "Trump vows Iran war to end very quickly, very soon"));
  assert.ok(same("India beat Pakistan to take Asian Games gold", "India beat Pakistan in Asian Games cricket final to take gold"));
  assert.ok(!same("India beat Pakistan to take Asian Games gold", "India beat Malaysia 5-1 to retain Asian Games gold"));
  assert.ok(!same("Fire at Mumbai chemical plant kills two", "Fire at Delhi chemical plant kills two"));
});

test("an event reported with different headlines by several outlets ranks first", () => {
  const out = buildSection([
    story("Solo regional story about a village road", "A", 50),
    story("Parliament passes landmark data protection bill after long debate", "A", 10),
    story("Landmark data protection bill passes Parliament after long debate", "B", 9),
    story("Parliament passes data protection bill following long debate", "C", 8),
  ]);
  assert.match(out[0].title, /data protection/i);
  assert.equal(out[0].alsoReportedBy.length, 2);
  assert.equal(out.length, 2);
});

test("isRoundup catches briefings and digests, not ordinary headlines", () => {
  for (const t of [
    "Evening news wrap: Indian men's cricket and hockey teams win gold; Guwahati police arrest seven & more",
    "Morning briefing: markets slide as oil jumps",
    "Today's evening brief: five things to know",
    "News roundup: Parliament, markets and monsoon",
    "Top headlines today: Iran, oil and the Fed",
    "Headlines of the day",
    "Weekly digest of climate stories",
    "Cricket win, hockey gold, rain alert & more",
  ]) assert.ok(isRoundup(t), t);
  for (const t of [
    "Morning news conference postponed after minister falls ill",
    "Cabinet to wrap up the budget session early",
    "Parliament passes landmark data protection bill",
    "Evening Standard owner sells stake",
    "Daily wage workers protest in Delhi",
    "Brief respite for markets as oil eases",
  ]) assert.ok(!isRoundup(t), t);
});

test("buildSection skips roundups, including carried-over ones", () => {
  const items = [
    { title: "Evening news wrap: cricket win; arrests & more", snippet: "", url: "https://a.example/wrap", source: "A", publishedAt: 2 },
    { title: "Parliament passes landmark data protection bill", snippet: "", url: "https://a.example/bill", source: "A", publishedAt: 1 },
  ];
  assert.deepEqual(buildSection(items).map((i) => i.title), ["Parliament passes landmark data protection bill"]);
});

test("keepTopics drops stories whose topic is not wanted, and keeps unrated ones", () => {
  const mk = (n, topic) => ({ title: `Distinct headline number ${n} about something`, snippet: "", url: `https://a.example/${n}`, source: `S${n}`, publishedAt: n, topic });
  const out = buildSection([mk(1, "economy"), mk(2, "politics"), mk(3, undefined), mk(4, "other")], { classify: { keepTopics: ["economy"] } });
  assert.deepEqual(out.map((i) => i.topic).sort(), ["economy", undefined]);
});

test("trimPool keeps each source's newest stories, with a larger allowance for sources that have several feeds", () => {
  const mk = (source, n) => ({ title: `${source} story ${n}`, snippet: "", url: `https://${source}.example/${n}`, source, publishedAt: n });
  const items = [...Array.from({ length: 10 }, (_, n) => mk("one", n)), ...Array.from({ length: 10 }, (_, n) => mk("many", n))];
  const out = trimPool(items, (s) => (s === "many" ? 6 : 2));
  assert.equal(out.filter((i) => i.source === "one").length, 2);
  assert.equal(out.filter((i) => i.source === "many").length, 6);
  assert.deepEqual(out.filter((i) => i.source === "one").map((i) => i.publishedAt).sort(), [8, 9], "the newest ones");
});

test("the per-source cap applies after ranking: a source's important older story beats its minor newer ones", () => {
  const mk = (n, importance, source = "A") => ({ title: `Unrelated distinct headline ${n} ${source}`, snippet: "", url: `https://${source}.example/${n}`, source, publishedAt: n, importance });
  const items = [mk(1, 5), mk(2, 3), mk(3, 3), mk(4, 3), mk(5, 3), mk(1, 3, "B")];
  const out = buildSection(items, { perSource: 4, classify: { minImportance: 2 } });
  assert.equal(out[0].importance, 5, "the oldest story is first because it matters most");
  assert.equal(out.filter((i) => i.source === "A").length, 4, "still at most perSource from one source");
  assert.ok(out.some((i) => i.source === "B"));
});

test("isJournalChatter skips journal comments and editorials, not papers", () => {
  for (const t of ["[Comment] Combining immunotherapy with radiation in lung cancer", "[Editorial] The week in science", "[Correspondence] A reply", "[Obituary] A pioneer of surgery"]) assert.ok(isJournalChatter(t), t);
  for (const t of ["Survodutide Once Weekly in Adults with Obesity and Type 2 Diabetes", "Effects of semaglutide on kidney disease: a randomized trial", "Comment sections are changing news"]) assert.ok(!isJournalChatter(t), t);
});
