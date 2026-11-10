import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/* The site's collections, edited in OP System's « Contenu » (which also writes this file when the team adds a
   collection or a field): one file per item in src/content/<collection>/, named by its slug. Names are code
   (English camelCase); each .describe() is the label people see, in the client's language. Every field is optional
   but the name; `visible` hides an item everywhere, `order` sorts them (src/utils/content.ts). Keep this form: one
   defineCollection per collection, a glob() loader, its z.object(); nothing else goes here (CLAUDE.md, Content). */

const concerns = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/concerns" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string().describe("Name"),
        group: z.enum(["Structure", "Surface"]).optional().describe("Group"),
        image: image().optional().describe("Photo (the page's opening and the home list's preview)"),
        imageAlt: z.string().optional().describe("Photo description"),
        statement: z.string().optional().describe("Opening statement (words in <em> are set in the lighter cut). The page shows once this is filled"),
        consultation: z.string().optional().describe("Consultation length"),
        assessedBy: z.string().optional().describe("Assessed by"),
        happening: z.string().optional().describe("What is happening"),
        factors: z
          .array(z.object({ title: z.string(), text: z.string() }))
          .optional()
          .describe("What is happening: the factors"),
        recommended: reference("treatments").optional().describe("Recommended starting point"),
        recommendedText: z.string().optional().describe("Why it is the starting point"),
        also: z.array(reference("treatments")).optional().describe("Also considered"),
        alongside: z.array(reference("concerns")).optional().describe("Often considered alongside"),
        alongsideText: z.string().optional().describe("Often considered alongside: the line under each"),
        steps: z
          .array(z.object({ title: z.string(), text: z.string() }))
          .optional()
          .describe("How we treat: the steps"),
        stepsImage: image().optional().describe("How we treat: the photo"),
        stepsImageAlt: z.string().optional().describe("How we treat: photo description"),
        products: z.array(reference("products")).optional().describe("Products we would recommend"),
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
        summary: z.string().optional().describe("In a few words (Pigment-targeting laser)"),
        image: image().optional().describe("Photo"),
        imageAlt: z.string().optional().describe("Photo description"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Treatments"),
});

const products = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/products" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string().describe("Name"),
        text: z.string().optional().describe("What it is for"),
        image: image().optional().describe("Photo"),
        imageAlt: z.string().optional().describe("Photo description"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Products"),
});

const articles = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/articles" }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().describe("Title"),
        date: z.coerce.date().optional().describe("Date"),
        image: image().optional().describe("Photo"),
        imageAlt: z.string().optional().describe("Photo description"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Journal"),
});

const results = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/results" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string().describe("Treatment"),
        image: image().optional().describe("After photo"),
        imageAlt: z.string().optional().describe("After photo description"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Results"),
});

export const collections = { concerns, treatments, products, articles, results };
