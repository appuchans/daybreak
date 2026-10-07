// Checks config.json the way the build will use it. These tests run before every build, so they check
// structure, not today's choices: switching the India tab to another country or the sports line-up must
// not need a test change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveConfig, MAX_SPORTS } from "../scripts/resolve.mjs";

const raw = JSON.parse(await readFile(new URL("../scripts/config.json", import.meta.url), "utf8"));
const config = resolveConfig(raw);

test("config resolves with no problems", () => {
  assert.deepEqual(config.problems, []);
});

test("sections: unique ids and labels, >= 2 https feeds each, valid only/exclude patterns", () => {
  const ids = config.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of config.sections) {
    assert.ok(s.label, s.id);
    assert.ok(s.feeds.length >= 2, `${s.id} needs at least 2 feeds`);
    for (const f of s.feeds) {
      assert.ok(f.name && f.url.startsWith("https://"), `${s.id}/${f.name}`);
      for (const p of [...(f.only ?? []), ...(f.exclude ?? [])]) assert.doesNotThrow(() => new RegExp(p), `${f.name}: ${p}`);
    }
  }
});

test("country sections: a region name, guidance, government and politics first; World drops their domestic news", () => {
  assert.ok(config.regions.length >= 1);
  for (const r of config.regions) {
    const s = config.sections.find((x) => x.id === r.id);
    assert.ok(r.name && s.classify?.guidance, r.id);
    assert.deepEqual(s.classify.priorityTopics, ["policy", "politics", "defense", "incident"], r.id);
  }
  const world = config.sections.find((s) => s.id === "world");
  assert.deepEqual(world.classify.dropFocus, config.regions.map((r) => r.id));
  assert.ok(!world.classify.guidance.includes("{regions}"));
  assert.deepEqual(world.classify.dropScopes, ["state", "local"], "a story about one state or city is domestic news");
});

test("sports: 1 to 5 sports, each with vetted feeds; the guidance names them", () => {
  const raw_ = raw.sections.find((s) => s.sports);
  assert.ok(raw_.sports.length >= 1 && raw_.sports.length <= MAX_SPORTS);
  for (const [name, entry] of Object.entries(raw_.sportFeeds)) assert.ok(entry.label && entry.feeds.length >= 2, `${name} needs a label and at least 2 feeds`);
  const sports = config.sections.find((s) => s.id === raw_.id);
  assert.ok(!sports.classify.guidance.includes("{sports}"));
  for (const s of raw_.sports) assert.ok(sports.classify.guidance.includes(raw_.sportFeeds[s].label), s);
  // A multi-sport feed must be narrowed to its sport by URL path.
  for (const entry of Object.values(raw_.sportFeeds)) for (const f of entry.feeds) if (f.url.includes("talksport.com")) assert.ok(f.only?.length, f.name);
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

test("settings: schedule fits the workflow's wait (whole hours dividing a day, at most 4) and the page settings are complete", () => {
  const { schedule, topNews } = config;
  assert.ok([1, 2, 3, 4].includes(schedule.everyHours), "a job may wait at most 6 hours; the period must divide 24 hours");
  assert.ok(Number.isInteger(schedule.minutePast) && schedule.minutePast >= 0 && schedule.minutePast < 60);
  assert.ok(topNews.label && Number.isInteger(topNews.headlinesPerSection) && topNews.headlinesPerSection > 0);
  assert.ok(topNews.leadSections.length, "mark at least one section `lead: true`");
  assert.ok(config.ai.model && Number.isInteger(config.ai.summariesPerRun) && Number.isInteger(config.minFill));
});
