import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    // Origem do conteúdo: post próprio, projeto do GitHub ou matéria do LinkedIn.
    source: z.enum(['artigo', 'github', 'linkedin']).default('artigo'),
    sourceUrl: z.string().url().optional(),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    link: z.string().url(),
    pinned: z.boolean().default(false),
    order: z.number().default(99),
  }),
});

export const collections = { blog, projects };
