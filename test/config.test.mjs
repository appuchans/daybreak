import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../scripts/config.json", import.meta.url), "utf8"));

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
  assert.deepEqual(config.sections.map((s) => s.id), ["world", "us", "india", "tech", "business", "health", "sports"]);
});

// Sports is the one exception: its Indian outlets are cricket and football feeds, not general news.
test("India-based outlets feed the India and Sports sections only", () => {
  const indian = /thehindu|timesofindia|indiatimes|ndtv|hindustantimes|livemint|economictimes|businessline/;
  for (const s of config.sections.filter((s) => s.id !== "india" && s.id !== "sports")) {
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

test("Business keeps only economy-topic stories and drops minor, personal-finance level ones", () => {
  const { classify } = config.sections.find((s) => s.id === "business");
  assert.deepEqual(classify.keepTopics, ["economy"]);
  assert.ok(classify.minImportance >= 3);
  assert.ok(classify.guidance.includes("personal-finance"));
});

test("Health reserves room for research and pharma stories", () => {
  const { classify } = config.sections.find((s) => s.id === "health");
  assert.deepEqual(classify.reserve.topics, ["research", "pharma"]);
  assert.ok(classify.reserve.count >= 4);
  assert.deepEqual(classify.priorityTopics, ["research", "pharma"]);
  assert.equal(classify.priorityBonus, 0, "the reserve is the guarantee; a bonus on top crowded out public-health news");
});

test("Sports keeps to cricket and football feeds", () => {
  const sports = config.sections.find((s) => s.id === "sports");
  assert.ok(sports.feeds.length >= 8);
  assert.ok(sports.classify.guidance.includes("cricket") && sports.classify.guidance.includes("football"));
  for (const f of sports.feeds) for (const p of [...(f.only ?? []), ...(f.exclude ?? [])]) assert.doesNotThrow(() => new RegExp(p), `${f.name}: ${p}`);
  // General multi-sport feeds must be narrowed to a sport by URL path.
  assert.deepEqual(sports.feeds.find((f) => f.name === "talkSPORT").only, ["^/football/"]);
});

test("settings: schedule fits the workflow's wait (whole hours dividing a day, at most 4) and the page settings are complete", () => {
  const { schedule, topNews } = config;
  assert.ok([1, 2, 3, 4].includes(schedule.everyHours), "a job may wait at most 6 hours; the period must divide 24 hours");
  assert.ok(Number.isInteger(schedule.minutePast) && schedule.minutePast >= 0 && schedule.minutePast < 60);
  assert.ok(Number.isInteger(config.staleAfterMinutes) && config.staleAfterMinutes > 0);
  assert.ok(topNews.label && Number.isInteger(topNews.headlinesPerSection) && topNews.headlinesPerSection > 0);
  const ids = config.sections.map((s) => s.id);
  assert.ok(topNews.leadSections.length && topNews.leadSections.every((id) => ids.includes(id)), "lead sections must exist");
  assert.ok(config.ai.model && Number.isInteger(config.ai.summariesPerRun) && Number.isInteger(config.minFill));
});
