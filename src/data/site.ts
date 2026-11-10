/** The clinic's facts and the site's lists of links, as the design draws them (Home.pdf). Written once here: the
 * header's menu, the footer and the clinic's data for search engines all read this file, and OP System's Modifier
 * edits its lists (`data-op-source="src/data/site.ts"`). */

/** Where every « Book a consultation » leads, until the clinic says how it books (card c-booking). */
export const BOOK_URL = "/book";

export const clinic = {
  name: "Dr Tranter Aesthetics",
  street: "1/54 Jonson Street",
  locality: "Byron Bay",
  region: "NSW",
  postcode: "2481",
  country: "AU",
  phone: "(02) 6680 7819",
  /** The dialled form of the phone number. */
  phoneHref: "+61266807819",
  /** AHPRA registration: the design's placeholder, to replace with the real number (supply s-ahpra). */
  ahpra: "MED0000000000",
  hours: [
    { days: "Mon", time: "9am to 3pm", schema: ["Mo"], opens: "09:00", closes: "15:00" },
    { days: "Tue", time: "9am to 5pm", schema: ["Tu"], opens: "09:00", closes: "17:00" },
    { days: "Wed", time: "9am to 5pm", schema: ["We"], opens: "09:00", closes: "17:00" },
    { days: "Thu", time: "9am to 6pm", schema: ["Th"], opens: "09:00", closes: "18:00" },
    { days: "Fri", time: "9am to 5pm", schema: ["Fr"], opens: "09:00", closes: "17:00" },
    { days: "Sat", time: "9am to 2pm", schema: ["Sa"], opens: "09:00", closes: "14:00" },
  ],
};

/** Opening hours as the footer writes them: days that share a time share a line, as in the design. */
export const hoursLines = [
  "Mon 9am to 3pm",
  "Tue to Fri 9am to 5pm (Thu until 6pm)",
  "Sat 9am to 2pm",
];

export type SiteLink = {
  label: string;
  /** A link without its address is hidden until the address arrives. */
  href?: string;
};

/** The clinic's pages, as the footer and the menu list them. The addresses of the pages not drawn yet are the
 * site's own choice. */
export const clinicLinks: SiteLink[] = [
  { label: "All treatments", href: "/treatments" },
  { label: "Our approach", href: "/approach" },
  { label: "Results", href: "/results" },
  { label: "Our team", href: "/team" },
  { label: "The Clinic", href: "/clinic" },
  { label: "Journal", href: "/journal" },
];

/** One Connect list for the menu and the footer (decision d-connect). */
export const connectLinks: SiteLink[] = [
  { label: "Contact", href: "/contact" },
  { label: "Careers", href: "/careers" },
  { label: "Facebook" },
  { label: "Instagram" },
  { label: "LinkedIn" },
];

export const legalLinks: SiteLink[] = [
  { label: "Risks and complications", href: "/risks-and-complications" },
  { label: "Privacy policy", href: "/privacy-policy" },
  { label: "Terms", href: "/terms" },
  { label: "Complaints", href: "/complaints" },
];

/** The concern's page. */
export const concernHref = (id: string) => `/concerns/${id}`;
