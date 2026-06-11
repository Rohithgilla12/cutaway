import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const explainers = defineCollection({
  loader: glob({
    pattern: "*/index.mdx",
    base: "./src/content/explainers",
    generateId: ({ entry }) => entry.replace(/\/index\.mdx$/, ""),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    number: z.number().int().positive(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { explainers };
