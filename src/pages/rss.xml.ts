import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const entries = await getCollection("explainers", ({ data }) => !data.draft);
  return rss({
    title: "Cutaway",
    description: "Interactive explainers of backend and systems internals — the casing removed.",
    site: context.site!,
    items: entries
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .map((entry) => ({
        title: entry.data.title,
        description: entry.data.description,
        pubDate: entry.data.pubDate,
        link: `/${entry.id}/`,
      })),
  });
}
