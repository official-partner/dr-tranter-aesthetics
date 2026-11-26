import { RISKS_PATH } from "@/consts";

/* The questions every treatment's page answers (brief C2, Standard FAQ), in the order shown. Written once, shown on
   each treatment's page; OP System's Modifier edits them as the list « treatment-faq ». */
export const treatmentFaq = [
  {
    id: "candidate",
    title: "Am I a suitable candidate for this treatment?",
    text: "Every patient is different, so suitability is assessed during a consultation with our doctor. We'll discuss your concerns, medical history and goals, and recommend the approach that best suits your skin. If this treatment isn't right for you, we'll talk you through other options.",
  },
  {
    id: "hurt",
    title: "Does the treatment hurt?",
    text: "Comfort levels vary from person to person. We'll explain what to expect before your treatment and use measures such as numbing cream where appropriate to keep you as comfortable as possible.",
  },
  {
    id: "downtime",
    title: "Is there any downtime?",
    text: "Recovery depends on the treatment and on your skin. Some patients return to their usual activities straight away, while others may experience redness or swelling for a few days. We'll give you clear aftercare instructions at your appointment.",
  },
  {
    id: "sessions",
    title: "How many sessions will I need?",
    text: "The number of sessions depends on your concerns and how your skin responds. Your doctor will recommend a treatment plan during your consultation and review it with you as you go.",
  },
  {
    id: "risks",
    title: "What are the possible risks and side effects?",
    text: `As with any medical treatment, there are possible risks and side effects. Your doctor will discuss these with you in detail before you decide to proceed. You can also read more on our <a href="${RISKS_PATH}">Risks page</a>.`,
  },
];
