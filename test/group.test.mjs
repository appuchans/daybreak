import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGroups, groupEvents, buildUser } from "../scripts/group.mjs";
import { HaltGemini } from "../scripts/gemini.mjs";
import { buildSection } from "../scripts/news.mjs";

const item = (n, over = {}) => ({ title: `Headline number ${n}`, snippet: "", url: `https://a.example/${n}`, source: `S${n}`, publishedAt: Date.UTC(2026, 9, 3, 10, n), ...over });

test("parseGroups keeps valid groups of two or more, drops invalid ids, repeats and singletons", () => {
  assert.deepEqual(parseGroups("```json\n[[0,2],[1],[3,3],[2,4],[4,9,5]]\n```", 6), [[0, 2], [4, 5]]);
  assert.deepEqual(parseGroups("no json", 3), []);
  assert.deepEqual(parseGroups('{"a":[0,1]}', 3), []);
  assert.deepEqual(parseGroups('[["a","b"],[0,1]]', 3), [[0, 1]]);
});

test("buildUser lists headlines as data in a JSON array", () => {
  const rows = JSON.parse(buildUser([item(1, { snippet: "x".repeat(300) })]).split("Items:\n")[1]);
  assert.equal(rows[0].headline, "Headline number 1");
  assert.equal(rows[0].note.length, 120);
});

test("groupEvents labels items that report one event with a shared eventId", async () => {
  const items = [item(1), item(2), item(3)];
  const stats = await groupEvents(items, { call: async () => "[[0,2]]" });
  assert.equal(items[0].eventId, items[2].eventId);
  assert.equal(items[1].eventId, undefined);
  assert.deepEqual([stats.groups, stats.grouped], [1, 2]);
});

test("groupEvents fails open: errors are logged, a quota error is reported, nothing is grouped", async () => {
  const logs = [];
  const items = [item(1), item(2)];
  const stats = await groupEvents(items, { call: async () => { throw new HaltGemini("HTTP 429 RESOURCE_EXHAUSTED"); }, log: (m) => logs.push(m) });
  assert.equal(items[0].eventId, undefined);
  assert.ok(stats.halted.startsWith("HTTP 429"));
  assert.ok(logs[0].startsWith("::warning::AI event grouping failed"));
  assert.deepEqual(await groupEvents([item(1)], { call: async () => { throw new Error("must not be called"); } }), { groups: 0, grouped: 0, halted: null });
});

test("buildSection merges items that share an eventId, credits every outlet, and hides the label", () => {
  const items = [
    item(1, { title: "Medical transport airplane missing off Massachusetts, Coast Guard says", eventId: "ev:plane", importance: 4 }),
    item(2, { title: "Coast Guard searching off Nantucket for missing Boston-bound jet", eventId: "ev:plane", importance: 4 }),
    item(3, { title: "Medical plane missing near Nantucket with six on board", eventId: "ev:plane", importance: 4 }),
    item(4, { title: "Senate votes on the budget", importance: 4 }),
  ];
  const out = buildSection(items, { classify: { minImportance: 2 } });
  assert.equal(out.length, 2);
  const plane = out.find((i) => /missing/.test(i.title));
  assert.equal(plane.alsoReportedBy.length, 2);
  assert.equal(plane.eventId, undefined);
  assert.equal(out[0], plane, "three outlets on one event outrank a single-outlet story of equal importance");
});
