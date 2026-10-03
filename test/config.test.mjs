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
