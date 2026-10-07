import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClassification, classifyItems, buildUser, CACHE_VERSION, cacheVersion } from "../scripts/classify.mjs";
import { HaltGemini } from "../scripts/gemini.mjs";
import { buildSection } from "../scripts/news.mjs";

const item = (n, over = {}) => ({ title: `Headline number ${n}`, snippet: "", url: `https://a.example/${n}`, source: "A", publishedAt: Date.UTC(2026, 9, 3, 10, n), ...over });
const noSleep = () => Promise.resolve();
const reply = (rows) => async () => JSON.stringify(rows);

test("parseClassification accepts valid rows, tolerates code fences, and ignores invalid ones", () => {
  const text = '```json\n[{"id":0,"scope":"local","importance":2,"topic":"incident","focus":"us","clickbait":true},{"id":1,"scope":"national","importance":5,"topic":"astrology","focus":"mars"},{"id":2,"scope":"galaxy","importance":3},{"id":3,"scope":"state","importance":9},{"id":7,"scope":"state","importance":3},{"id":"x","scope":"state","importance":3}]\n```';
  const out = parseClassification(text, 4);
  assert.deepEqual([...out.keys()], [0, 1]);
  assert.deepEqual(out.get(0), { scope: "local", importance: 2, topic: "incident", focus: "us", clickbait: true });
  assert.deepEqual(out.get(1), { scope: "national", importance: 5, topic: "other", focus: "world", clickbait: false });
  assert.equal(parseClassification("not json at all", 3).size, 0);
  assert.equal(parseClassification('{"id":0}', 3).size, 0);
});

test("buildUser puts headlines in a JSON array and trims the note", () => {
  const user = buildUser("GUIDE", [item(1, { snippet: "x".repeat(300) })]);
  assert.ok(user.startsWith("GUIDE\n\nItems:\n"));
  const rows = JSON.parse(user.split("Items:\n")[1]);
  assert.equal(rows[0].headline, "Headline number 1");
  assert.equal(rows[0].note.length, 160);
});

test("classifyItems reuses cached answers and only asks about new stories", async () => {
  const items = [item(1), item(2)];
  const cache = new Map([["a.example/1", { scope: "national", importance: 4, topic: "policy", focus: "us", clickbait: false, v: cacheVersion() }]]);
  const seen = [];
  const stats = await classifyItems(items, { guidance: "G", cache, delayMs: 0, sleep: noSleep, call: async (sys, user) => { seen.push(user); return JSON.stringify([{ id: 0, scope: "local", importance: 2, topic: "incident", focus: "india", clickbait: true }]); } });
  assert.deepEqual([stats.cached, stats.classified], [1, 1]);
  assert.equal(items[0].scope, "national");
  assert.equal(items[1].scope, "local");
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("Headline number 2") && !seen[0].includes("Headline number 1"));
  assert.deepEqual(cache.get("a.example/2"), { scope: "local", importance: 2, topic: "incident", focus: "india", clickbait: true, v: cacheVersion() });
  assert.equal(items[1].clickbait, true);
});

test("classifyItems sends at most 40 stories per request", async () => {
  const items = Array.from({ length: 41 }, (_, n) => item(n));
  let calls = 0;
  await classifyItems(items, { guidance: "G", cache: new Map(), delayMs: 0, sleep: noSleep, call: async () => { calls++; return "[]"; } });
  assert.equal(calls, 2);
});

test("a quota or key error halts later batches and leaves stories unclassified", async () => {
  const items = Array.from({ length: 41 }, (_, n) => item(n));
  const logs = [];
  let calls = 0;
  const stats = await classifyItems(items, { guidance: "G", cache: new Map(), delayMs: 0, sleep: noSleep, log: (m) => logs.push(m), call: async () => { calls++; throw new HaltGemini("HTTP 429 RESOURCE_EXHAUSTED"); } });
  assert.equal(calls, 1);
  assert.equal(stats.unclassified, 41);
  assert.ok(stats.halted.startsWith("HTTP 429"));
  assert.ok(logs[0].startsWith("::warning::AI classification failed"));
  assert.equal(items[0].scope, undefined);
});

test("buildSection drops wrong-scope and minor stories, keeps unclassified ones, and ranks by importance", () => {
  const items = [
    item(1, { title: "Railway overbridge planned in a small town", scope: "local", importance: 2 }),
    item(2, { title: "State assembly passes a state bill", scope: "state", importance: 2 }),
    item(3, { title: "Foreign election result with no India link", scope: "international", importance: 4 }),
    item(4, { title: "Supreme Court rules on a national matter", scope: "national", importance: 5, source: "B" }),
    item(5, { title: "Minor national notice from a ministry", scope: "national", importance: 2, source: "C" }),
    item(6, { title: "Story the classifier never saw", source: "D" }),
    item(7, { title: "Notable national policy change", scope: "national", importance: 3, source: "E" }),
  ];
  const out = buildSection(items, { classify: { dropScopes: ["local", "international"], minImportance: 3 } });
  const titles = out.map((i) => i.title);
  assert.ok(!titles.some((t) => /overbridge|Foreign election|Minor national/.test(t)));
  assert.ok(titles.includes("Story the classifier never saw"));
  assert.ok(titles.includes("State assembly passes a state bill") === false, "state at importance 2 is below the minimum");
  assert.equal(titles[0], "Supreme Court rules on a national matter");
  assert.equal(titles.indexOf("Notable national policy change") < titles.indexOf("Story the classifier never saw"), true);
});

test("a section without classify settings ignores scope fields", () => {
  const out = buildSection([item(1, { scope: "local", importance: 1 })]);
  assert.equal(out.length, 1);
});

test("a cached answer from an older rubric version is asked again", async () => {
  const items = [item(1)];
  const cache = new Map([["a.example/1", { scope: "national", importance: 4, clickbait: false, v: cacheVersion() - 1 }]]);
  let calls = 0;
  await classifyItems(items, { guidance: "G", cache, delayMs: 0, sleep: noSleep, call: async () => { calls++; return JSON.stringify([{ id: 0, scope: "national", importance: 4, clickbait: true }]); } });
  assert.equal(calls, 1);
  assert.equal(items[0].clickbait, true);
});

test("ranking: importance leads in any section, other outlets add up to 2, unrated counts as 3", () => {
  const at = (n, over) => item(n, { ...over });
  const items = [
    at(1, { title: "Celebrity gelato feature", importance: 2, source: "A" }),
    at(2, { title: "Unrated story from the feed", source: "B" }),
    at(3, { title: "Major ruling by the supreme court on elections", importance: 5, source: "C" }),
    at(4, { title: "Notable policy change on fuel taxes this week", importance: 3, source: "D" }),
    at(5, { title: "Notable policy change on fuel taxes announced this week", importance: 3, source: "E" }),
  ];
  const titles = buildSection(items).map((i) => i.title);
  assert.equal(titles[0], "Major ruling by the supreme court on elections");
  assert.equal(titles.at(-1), "Celebrity gelato feature");
  assert.ok(titles.indexOf("Notable policy change on fuel taxes this week") < titles.indexOf("Unrated story from the feed"));
});

test("a section with only a minimum importance drops trivial stories and keeps the rest", () => {
  const out = buildSection([item(1, { importance: 1, scope: "national" }), item(2, { importance: 2, scope: "local" })], { classify: { minImportance: 2 } });
  assert.deepEqual(out.map((i) => i.importance), [2]);
});

test("priority topics lift government, defense and incident stories above higher-importance features", () => {
  const items = [
    item(1, { title: "Clinical trial offers hope for a rare condition", importance: 4, topic: "other", source: "A" }),
    item(2, { title: "Military strikes escalate the regional war", importance: 5, topic: "defense", source: "B" }),
    item(3, { title: "Senate passes the defense budget", importance: 3, topic: "policy", source: "C" }),
    item(4, { title: "Tech giant unveils a new phone", importance: 4, topic: "other", source: "D" }),
  ];
  const plain = buildSection(items, { classify: { minImportance: 2 } }).map((i) => i.title);
  assert.equal(plain[0], "Military strikes escalate the regional war");
  assert.equal(plain.at(-1), "Senate passes the defense budget", "without a topic bonus the importance-3 policy story ranks last");
  const lifted = buildSection(items, { classify: { minImportance: 2, priorityTopics: ["policy", "defense"], priorityBonus: 2 } }).map((i) => i.title);
  assert.deepEqual(lifted.slice(0, 2), ["Military strikes escalate the regional war", "Senate passes the defense budget"]);
  assert.ok(["Clinical trial offers hope for a rare condition", "Tech giant unveils a new phone"].includes(lifted.at(-1)));
});

test("a section can drop stories whose subject is another country's domestic news", () => {
  const items = [
    item(1, { title: "Senate stalls the budget as shutdown nears", importance: 5, focus: "us", source: "A" }),
    item(2, { title: "Parliament in Delhi debates a new bill", importance: 4, focus: "india", source: "B" }),
    item(3, { title: "Talks on the regional war resume in Geneva", importance: 4, focus: "world", source: "C" }),
    item(4, { title: "Unrated story from the feed", source: "D" }),
  ];
  const titles = buildSection(items, { classify: { dropFocus: ["us", "india"] } }).map((i) => i.title);
  assert.deepEqual(titles.sort(), ["Talks on the regional war resume in Geneva", "Unrated story from the feed"]);
});
