import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClassification, classifyItems, buildUser } from "../scripts/classify.mjs";
import { HaltGemini } from "../scripts/gemini.mjs";
import { buildSection } from "../scripts/news.mjs";

const item = (n, over = {}) => ({ title: `Headline number ${n}`, snippet: "", url: `https://a.example/${n}`, source: "A", publishedAt: Date.UTC(2026, 9, 3, 10, n), ...over });
const noSleep = () => Promise.resolve();
const reply = (rows) => async () => JSON.stringify(rows);

test("parseClassification accepts valid rows, tolerates code fences, and ignores invalid ones", () => {
  const text = '```json\n[{"id":0,"scope":"local","importance":2,"clickbait":true},{"id":1,"scope":"national","importance":5},{"id":2,"scope":"galaxy","importance":3},{"id":3,"scope":"state","importance":9},{"id":7,"scope":"state","importance":3},{"id":"x","scope":"state","importance":3}]\n```';
  const out = parseClassification(text, 4);
  assert.deepEqual([...out.keys()], [0, 1]);
  assert.deepEqual(out.get(0), { scope: "local", importance: 2, clickbait: true });
  assert.deepEqual(out.get(1), { scope: "national", importance: 5, clickbait: false });
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
  const cache = new Map([["a.example/1", { scope: "national", importance: 4, clickbait: false }]]);
  const seen = [];
  const stats = await classifyItems(items, { guidance: "G", cache, delayMs: 0, sleep: noSleep, call: async (sys, user) => { seen.push(user); return JSON.stringify([{ id: 0, scope: "local", importance: 2, clickbait: true }]); } });
  assert.deepEqual([stats.cached, stats.classified], [1, 1]);
  assert.equal(items[0].scope, "national");
  assert.equal(items[1].scope, "local");
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes("Headline number 2") && !seen[0].includes("Headline number 1"));
  assert.deepEqual(cache.get("a.example/2"), { scope: "local", importance: 2, clickbait: true });
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

test("a cached answer from before the clickbait question is asked again", async () => {
  const items = [item(1)];
  const cache = new Map([["a.example/1", { scope: "national", importance: 4 }]]);
  let calls = 0;
  await classifyItems(items, { guidance: "G", cache, delayMs: 0, sleep: noSleep, call: async () => { calls++; return JSON.stringify([{ id: 0, scope: "national", importance: 4, clickbait: true }]); } });
  assert.equal(calls, 1);
  assert.equal(items[0].clickbait, true);
});
