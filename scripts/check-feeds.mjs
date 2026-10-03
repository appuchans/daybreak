// Reports, for each feed in a flat JSON list [{section, name, url}], whether it answers,
// how many valid items it returns, how fresh the newest is, and how many carry an image.
// Used to vet candidate sources before they enter feeds.json: node scripts/check-feeds.mjs scripts/candidates.json
import { readFile } from "node:fs/promises";
import { parseFeed } from "./news.mjs";

const list = JSON.parse(await readFile(process.argv[2], "utf8"));
const rows = await Promise.all(
  list.map(async (f) => {
    try {
      const res = await fetch(f.url, {
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "DaybreakBot/1.0 (+https://github.com/appuchans/daybreak)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      });
      if (!res.ok) return `${f.section}\t${f.name}\tFAIL HTTP ${res.status}\t${f.url}`;
      const items = parseFeed(await res.text(), f.name);
      if (!items.length) return `${f.section}\t${f.name}\tFAIL no valid items\t${f.url}`;
      const newest = Math.max(...items.map((i) => i.publishedAt));
      const hours = Math.round((Date.now() - newest) / 3_600_000);
      const img = Math.round((items.filter((i) => i.image).length / items.length) * 100);
      return `${f.section}\t${f.name}\tOK items=${items.length} newest=${hours}h img=${img}%\t${items[0].title.slice(0, 70)}`;
    } catch (err) {
      return `${f.section}\t${f.name}\tFAIL ${err.message ?? err}\t${f.url}`;
    }
  }),
);
console.log(rows.join("\n"));
