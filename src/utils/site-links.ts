import { getItems } from "@/utils/content";

/* The site's links, read by the footer and the menu: one place for each (CLAUDE.md, one place per fact). A page's
   address once it is built (Simon's brief, Nov 19, A2), the home until then. Contact and Careers open the « Send an
   enquiry » pop-up once it is built; the social addresses are still to come from the clinic. */
export type SiteLink = { label: string; href: string; footer?: boolean };

export const clinicLinks: SiteLink[] = [
  { label: "All treatments", href: "/" },
  { label: "Our approach", href: "/approach" },
  { label: "Results", href: "/" },
  { label: "Our team", href: "/" },
  { label: "The Clinic", href: "/" },
  { label: "Journal", href: "/" },
];

/* LinkedIn is the menu's only: the footer as drawn has four */
export const connectLinks: SiteLink[] = [
  { label: "Contact", href: "/" },
  { label: "Careers", href: "/" },
  { label: "Facebook", href: "/" },
  { label: "Instagram", href: "/" },
  { label: "LinkedIn", href: "/", footer: false },
];

export const legalLinks: SiteLink[] = [
  { label: "Risks and complications", href: "/" },
  { label: "Privacy policy", href: "/" },
  { label: "Terms", href: "/" },
  { label: "Complaints", href: "/" },
];

/** The concerns by group, each to its page once it has one, else to the Concerns page. */
export async function concernLinks() {
  const concerns = await getItems("concerns");
  const link = (c: (typeof concerns)[number]) => ({ id: c.id, name: c.data.name, href: c.data.statement ? `/concerns/${c.id}` : "/concerns" });
  return {
    structure: concerns.filter((c) => c.data.group === "Structure").map(link),
    surface: concerns.filter((c) => c.data.group !== "Structure").map(link),
  };
}
