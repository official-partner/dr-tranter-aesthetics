import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/* The site's collections, edited in OP System's « Contenu » (which also writes this file when the team adds a
   collection or a field): one file per item in src/content/<collection>/, named by its slug. Names are code
   (English camelCase); each .describe() is the label people see, in the client's language. Every field is optional
   but the name; `visible` hides an item everywhere, `order` sorts them (src/utils/content.ts). Keep this form: one
   defineCollection per collection, a glob() loader, its z.object(); nothing else goes here (CLAUDE.md, Content). */

const team = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/team" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string().describe("Nom"),
        role: z.string().optional().describe("Rôle"),
        bio: z.string().optional().describe("Présentation"),
        photo: image().optional().describe("Photo"),
        specialties: z.array(z.string()).optional().describe("Spécialités"),
        visible: z.boolean().default(true).describe("Visible sur le site"),
        order: z.number().optional().describe("Ordre"),
      })
      .describe("Équipe"),
});

const concerns = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/concerns" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string().describe("Name"),
        group: z.enum(["Structure", "Surface"]).describe("Group"),
        summary: z.string().optional().describe("Summary"),
        photo: image().optional().describe("Photo"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Concerns"),
});

const treatments = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/treatments" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string().describe("Name"),
        category: z
          .enum(["Injectables", "RF treatments", "Laser & light", "Facials & peels"])
          .optional()
          .describe("Category"),
        summary: z.string().optional().describe("Summary"),
        photo: image().optional().describe("Photo"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Treatments"),
});

const articles = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/articles" }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().describe("Title"),
        date: z.coerce.date().optional().describe("Date"),
        photo: image().optional().describe("Photo"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Journal articles"),
});

const results = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/results" }),
  schema: ({ image }) =>
    z
      .object({
        treatment: z.string().describe("Treatment"),
        beforePhoto: image().optional().describe("Before photo"),
        afterPhoto: image().optional().describe("After photo"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Results"),
});

export const collections = { team, concerns, treatments, articles, results };
