// Turns config.json into what the build runs on, so a country tab or the sports line-up is a config edit:
// - Sections with a `region` (a country or place, e.g. "India") are "country sections". The AI's `focus`
//   label offers one value per country section, and World's `dropFocus: "regions"` drops stories about
//   any of them. `{regions}` in a section's guidance becomes their names ("the United States or India").
// - Sports picks its feeds from `sportFeeds` by the names in `sports` (1 to MAX_SPORTS), and `{sports}`
//   in its guidance becomes their labels ("cricket and football (soccer)").
// - Sections marked `lead: true` can supply the Top News lead story.
export const MAX_SPORTS = 5;

export function listPhrase(names, conjunction) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1)}`;
}

export function resolveConfig(config) {
  const regions = config.sections.filter((s) => s.region).map((s) => ({ id: s.id, name: s.region }));
  const regionPhrase = listPhrase(regions.map((r) => r.name), "or");
  const problems = [];
  const sections = config.sections.map((section) => {
    let feeds = section.feeds ?? [];
    let sportsPhrase = "";
    if (section.sports) {
      const chosen = section.sports;
      if (chosen.length < 1 || chosen.length > MAX_SPORTS) problems.push(`${section.id}: choose 1 to ${MAX_SPORTS} sports, not ${chosen.length}`);
      const unknown = chosen.filter((s) => !section.sportFeeds?.[s]?.feeds?.length);
      if (unknown.length) problems.push(`${section.id}: no feeds for ${unknown.join(", ")} (known: ${Object.keys(section.sportFeeds ?? {}).join(", ")})`);
      const known = chosen.filter((s) => !unknown.includes(s));
      feeds = known.flatMap((s) => section.sportFeeds[s].feeds);
      sportsPhrase = listPhrase(known.map((s) => section.sportFeeds[s].label ?? s), "and");
    }
    let classify = section.classify;
    if (classify) {
      classify = { ...classify };
      if (classify.guidance) classify.guidance = classify.guidance.replaceAll("{regions}", regionPhrase).replaceAll("{sports}", sportsPhrase);
      if (classify.dropFocus === "regions") classify.dropFocus = regions.map((r) => r.id);
    }
    const { sportFeeds, ...rest } = section;
    return { ...rest, feeds, ...(classify ? { classify } : {}) };
  });
  const leadSections = config.sections.filter((s) => s.lead).map((s) => s.id);
  const topNews = config.topNews || leadSections.length ? { ...config.topNews, ...(leadSections.length ? { leadSections } : {}) } : undefined;
  return { ...config, sections, regions, topNews, problems };
}
