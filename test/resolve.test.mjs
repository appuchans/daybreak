import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, listPhrase } from "../scripts/resolve.mjs";
import { systemPrompt, parseClassification, cacheVersion } from "../scripts/classify.mjs";

const feeds = (n) => Array.from({ length: n }, (_, i) => ({ name: `F${i}`, url: `https://f.example/${i}` }));
const base = (country, sports) => ({
  sections: [
    { id: "world", label: "World", lead: true, feeds: feeds(2), classify: { dropFocus: "regions", guidance: "Domestic news of {regions} goes to those tabs." } },
    { id: "us", label: "US", region: "the United States", lead: true, feeds: feeds(2) },
    { id: country.id, label: country.label, region: country.name, lead: true, feeds: feeds(2) },
    { id: "sports", label: "Sports", sports, feeds: [], classify: { guidance: "Readers follow {sports} only." }, sportFeeds: {
      cricket: { label: "cricket", feeds: feeds(2) }, tennis: { label: "tennis", feeds: feeds(3) }, nfl: { label: "American football (NFL)", feeds: feeds(2) },
      nba: { label: "basketball (NBA)", feeds: feeds(2) }, mlb: { label: "baseball (MLB)", feeds: feeds(2) }, nhl: { label: "ice hockey (NHL)", feeds: feeds(2) },
    } },
  ],
});

test("switching the country tab is a config edit: focus values, World's drops, guidance and lead sections follow", () => {
  const c = resolveConfig(base({ id: "uk", label: "UK", name: "the United Kingdom" }, ["tennis", "nfl"]));
  assert.deepEqual(c.problems, []);
  assert.deepEqual(c.regions, [{ id: "us", name: "the United States" }, { id: "uk", name: "the United Kingdom" }]);
  const world = c.sections.find((s) => s.id === "world");
  assert.deepEqual(world.classify.dropFocus, ["us", "uk"]);
  assert.equal(world.classify.guidance, "Domestic news of the United States or the United Kingdom goes to those tabs.");
  assert.deepEqual(c.topNews.leadSections, ["world", "us", "uk"]);
  const prompt = systemPrompt(c.regions);
  assert.ok(prompt.includes("uk = domestic news of the United Kingdom") && !prompt.includes("india"));
  assert.equal(parseClassification('[{"id":0,"scope":"national","importance":4,"focus":"uk"}]', 1, c.regions).get(0).focus, "uk");
  assert.equal(parseClassification('[{"id":0,"scope":"national","importance":4,"focus":"india"}]', 1, c.regions).get(0).focus, "world", "an unknown focus counts as world");
  assert.notEqual(cacheVersion(c.regions), cacheVersion(), "a different set of countries is asked again");
});

test("sports: feeds come from the chosen sports, the guidance names them, and more than five is a problem", () => {
  const c = resolveConfig(base({ id: "india", label: "India", name: "India" }, ["tennis", "nfl"]));
  const sports = c.sections.find((s) => s.id === "sports");
  assert.equal(sports.feeds.length, 5);
  assert.equal(sports.classify.guidance, "Readers follow tennis and American football (NFL) only.");
  assert.equal(sports.sportFeeds, undefined, "the library is not passed on");
  const six = resolveConfig(base({ id: "india", label: "India", name: "India" }, ["cricket", "tennis", "nfl", "nba", "mlb", "nhl"]));
  assert.match(six.problems[0], /choose 1 to 5 sports, not 6/);
  const unknown = resolveConfig(base({ id: "india", label: "India", name: "India" }, ["cricket", "curling"]));
  assert.match(unknown.problems[0], /no feeds for curling/);
  assert.equal(unknown.sections.find((s) => s.id === "sports").feeds.length, 2, "known sports still work");
});

test("listPhrase", () => {
  assert.equal(listPhrase(["a"], "and"), "a");
  assert.equal(listPhrase(["a", "b", "c"], "or"), "a, b or c");
});
