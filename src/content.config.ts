import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/* The site's collections, edited in OP System's « Contenu » (which also writes this file when the team adds a
   collection or a field): one file per item in src/content/<collection>/, named by its slug. Names are code
   (English camelCase); each .describe() is the label people see, in the client's language. Every field is optional
   but the name; `visible` hides an item everywhere, `draft` keeps it on the staging only, `order` sorts them (src/utils/content.ts). Keep this form: one
   defineCollection per collection, a glob() loader, its z.object(); nothing else goes here (CLAUDE.md, Content). */

const concerns = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/concerns" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string().describe("Name"),
        group: z.enum(["Structure", "Surface"]).optional().describe("Group"),
        summary: z.string().optional().describe("Summary (its card on the Concerns page)"),
        image: image().optional().describe("Photo (the page's opening and the home list's preview)"),
        imageAlt: z.string().optional().describe("Photo description"),
        statement: z.string().optional().describe("Opening statement (words in italics are set in the lighter cut). The page shows once this is filled"),
        consultation: z.string().optional().describe("Consultation length"),
        assessedBy: z.string().optional().describe("Assessed by"),
        happening: z.string().optional().describe("What is happening"),
        factors: z
          .array(z.object({ id: z.string(), title: z.string().describe("Title"), text: z.string().describe("Text") }))
          .optional()
          .describe("What is happening: the factors"),
        recommended: reference("treatments").optional().describe("Recommended starting point"),
        recommendedText: z.string().optional().describe("Why it is the starting point"),
        also: z.array(reference("treatments")).optional().describe("Also considered"),
        alongside: z.array(reference("concerns")).optional().describe("Often considered alongside"),
        alongsideText: z.string().optional().describe("Often considered alongside: the line under each"),
        steps: z
          .array(z.object({ id: z.string(), title: z.string().describe("Title"), text: z.string().describe("Text") }))
          .optional()
          .describe("How we treat: the steps"),
        stepsImage: image().optional().describe("How we treat: the photo"),
        stepsImageAlt: z.string().optional().describe("How we treat: photo description"),
        products: z.array(reference("products")).optional().describe("Products we would recommend"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        draft: z.boolean().default(false).describe("Draft"),
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
        summary: z.string().optional().describe("In a few words"),
        intro: z.string().optional().describe("Description (its card on the Treatments page)"),
        category: z
          .enum(["Injectables", "RF treatments", "Laser & light", "Facials & peels"])
          .optional()
          .describe("Category"),
        featured: z.boolean().default(false).describe("Featured"),
        image: image().optional().describe("Photo"),
        imageAlt: z.string().optional().describe("Photo description"),
        statement: z.string().optional().describe("Opening statement (words in italics are set in the lighter cut). The page shows once this is filled"),
        duration: z.string().optional().describe("Duration"),
        downtime: z.string().optional().describe("Downtime"),
        sessions: z.string().optional().describe("Sessions"),
        performedBy: z.string().optional().describe("Performed by"),
        device: z.string().optional().describe("How it works: the device"),
        deviceText: z.string().optional().describe("How it works: the device's technology"),
        how: z.string().optional().describe("How it works"),
        handpieces: z
          .array(z.object({ id: z.string(), title: z.string().describe("Title"), text: z.string().describe("Text") }))
          .optional()
          .describe("How it works: the handpieces"),
        addresses: z
          .array(
            z.object({
              id: z.string(),
              concern: reference("concerns").describe("Concern"),
              text: z.string().optional().describe("What it may do for it (else the concern's own line)"),
            }),
          )
          .optional()
          .describe("What it may address: the concerns"),
        outcomes: z.array(z.string()).optional().describe("What it may address, for a treatment linked to no concern"),
        tiers: z
          .array(z.object({ id: z.string(), title: z.string().describe("Title"), text: z.string().describe("Text") }))
          .optional()
          .describe("Tailored to your skin: the settings"),
        tiersImage: image().optional().describe("Tailored to your skin: the photo"),
        tiersImageAlt: z.string().optional().describe("Tailored to your skin: photo description"),
        suits: z.string().optional().describe("Who it suits"),
        notSuitable: z.string().optional().describe("When it may not be suitable"),
        assessed: z.string().optional().describe("Assessed first"),
        before: z.string().optional().describe("Before"),
        during: z.string().optional().describe("During"),
        after: z.string().optional().describe("After"),
        risks: z.string().optional().describe("Risks"),
        alongside: z.array(reference("treatments")).optional().describe("Often considered alongside"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        draft: z.boolean().default(false).describe("Draft"),
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
        draft: z.boolean().default(false).describe("Draft"),
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
        topic: z.enum(["Skin health", "The Approach", "Technology"]).optional().describe("Topic (the Journal's filters)"),
        reviewedBy: z.string().optional().describe("Reviewed by"),
        summary: z.string().optional().describe("Summary (its card and the page's opening)"),
        // the article's text, a rich text in OP System's Contenu (its kind given here, Nov 23): subheadings, bold,
        // italic, links, lists and quotes, kept as Markdown
        body: z.string().optional().describe("Text").meta({ kind: "rich" }),
        image: image().optional().describe("Photo"),
        imageAlt: z.string().optional().describe("Photo description"),
        treatment: reference("treatments").optional().describe("The treatment it speaks of (beside its text)"),
        seoTitle: z.string().optional().describe("Title for Google"),
        seoDescription: z.string().optional().describe("Description for Google"),
        ogImage: image().optional().describe("Share image"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        draft: z.boolean().default(false).describe("Draft"),
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
        draft: z.boolean().default(false).describe("Draft"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Results"),
});

/* The team (Sam, Nov 25): the same people on the home and on Our team, and in the pop-up a member opens there, so a
   collection (CLAUDE.md, Content: the same items listed on several pages). Names and roles from the Figma (« Meet the
   team »), bios and photos to come from Sarah. */
const team = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/team" }),
  schema: ({ image }) =>
    z
      .object({
        name: z.string().describe("Name"),
        role: z.string().optional().describe("Role"),
        bio: z.string().optional().describe("Bio (the pop-up on Our team)"),
        photo: image().optional().describe("Portrait"),
        photoAlt: z.string().optional().describe("Portrait description"),
        visible: z.boolean().default(true).describe("Visible on the site"),
        draft: z.boolean().default(false).describe("Draft"),
        order: z.number().optional().describe("Order"),
      })
      .describe("Team"),
});

export const collections = { concerns, treatments, products, articles, results, team };
