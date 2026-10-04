// Last-resort sample, shown only when news.json cannot be fetched and nothing was saved.
export const FALLBACK = {
  generatedAt: "2026-10-03T08:00:00Z",
  order: ["world", "us", "india", "tech", "business", "health"],
  sections: {
    world: { label: "World", items: [
      { title: "Iran live updates: Trump says war will be over 'very soon,' but offers no details", snippet: "Latest from the Iran conflict as of Oct 1.", url: "https://abcnews.com/International/live-updates/iran-live-updates-saudi-foreign-minister-arrives-us/?id=136814503", source: "ABC News" },
      { title: "US announces $24.4 billion contract to speed up missile production", snippet: "The Defense Department says the agreement will support faster manufacturing of defence missiles.", url: "https://www.educationtimes.com/news/school-assembly-news-headlines-for-october-3-2026-top-national-international-business-and-sports-updates/articleshow/134635640.cms", source: "Education Times" },
    ] },
    us: { label: "US", items: [
      { title: "Top Democrats battle over California's proposed billionaire tax", snippet: "Sanders and Khanna rally for a one-time 5% wealth tax as early voting opens.", url: "https://abcnews.com/Politics/top-democrats-battle-californias-proposed-billionaire-tax/story?id=136951176", source: "ABC News" },
      { title: "Christa Pike unconscious and on ventilator after botched execution, attorneys say", snippet: "The execution was paused amid a federal challenge.", url: "https://abcnews.com/US/execution-lone-woman-tennessees-death-row-paused-federal/story?id=136893331", source: "ABC News" },
    ] },
    tech: { label: "Tech", items: [] },
    india: { label: "India", items: [
      { title: "Delhi launches AI-based pollution monitoring control centre", snippet: "The centre will track sources of air pollution in real time.", url: "https://www.educationtimes.com/news/school-assembly-news-headlines-for-october-3-2026-top-national-international-business-and-sports-updates/articleshow/134635640.cms", source: "Education Times" },
    ] },
    business: { label: "Business", items: [] },
    health: { label: "Health", items: [] },
  },
};
