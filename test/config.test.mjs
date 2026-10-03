import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../scripts/feeds.json", import.meta.url), "utf8"));

test("feed config: unique section ids, >= 2 https feeds each", () => {
  const ids = config.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of config.sections) {
    assert.ok(s.label, s.id);
    assert.ok(s.feeds.length >= 2, `${s.id} needs at least 2 feeds`);
    for (const f of s.feeds) assert.ok(f.name && f.url.startsWith("https://"), `${s.id}/${f.name}`);
  }
});

test("section order matches the product order", () => {
  assert.deepEqual(config.sections.map((s) => s.id), ["world", "us", "tech", "india", "business", "health"]);
});

test("India-based outlets feed the India section only", () => {
  const indian = /thehindu|timesofindia|indiatimes|ndtv|hindustantimes|livemint|economictimes|businessline/;
  for (const s of config.sections.filter((s) => s.id !== "india")) {
    for (const f of s.feeds) assert.ok(!indian.test(f.url), `${s.id}/${f.name} is an India-based feed`);
  }
});

test("Indian general-news feeds only take articles filed under India or national news", () => {
  const india = config.sections.find((s) => s.id === "india");
  const byUrl = (part) => india.feeds.find((f) => f.url.includes(part));
  assert.deepEqual(byUrl("ndtvnews-india-news").only, ["^/india-news/"]);
  assert.deepEqual(byUrl("-2128936835").only, ["^/india/"]);
  assert.ok(byUrl("thehindu.com/news/national").exclude.some((p) => p.includes("cities")));
  for (const f of india.feeds) for (const p of [...(f.only ?? []), ...(f.exclude ?? [])]) assert.doesNotThrow(() => new RegExp(p), `${f.name}: ${p}`);
});

test("the India section asks the AI to drop local and foreign stories", () => {
  const india = config.sections.find((s) => s.id === "india");
  assert.deepEqual(india.classify.dropScopes, ["local", "international"]);
  assert.ok(india.classify.minImportance >= 1 && india.classify.guidance.includes("local"));
});

test("US and India put government, politics, defense and incident stories first", () => {
  for (const id of ["us", "india"]) {
    const { classify } = config.sections.find((s) => s.id === id);
    assert.deepEqual(classify.priorityTopics, ["policy", "politics", "defense", "incident"], id);
    assert.ok(classify.priorityBonus >= 2, id);
  }
});

test("World drops stories that are mainly US or India domestic news", () => {
  const world = config.sections.find((s) => s.id === "world");
  assert.deepEqual(world.classify.dropFocus, ["us", "india"]);
  assert.deepEqual(world.classify.dropScopes, ["state", "local"], "a story about one state or city is domestic news");
});
