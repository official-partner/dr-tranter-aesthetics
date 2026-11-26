/* The clinic's details, written once: the hero, the footer, The Clinic and every Book button read them (CLAUDE.md: no fact in two files).
   The email is still to come from the clinic (Figma: « [email to be confirmed] »). */
export const clinic = {
  town: "Byron Bay",
  address: ["1/54 Jonson Street,", "Byron Bay NSW 2481"],
  hours: ["Mon 9am to 3pm", "Tue to Fri 9am to 5pm (Thu until 6pm)", "Sat 9am to 2pm"],
  phone: "(02) 6680 7819",
  email: undefined as string | undefined,
  /* the clinic's Pabau pages (Mia Endozo's tracking guide, Nov 21): every Book button leads to the booking page, which
     reports bookings to GA4 and Meta itself; the enquiry form is Pabau's Capture Form 14 (its leads go to Pabau) */
  booking: "https://booking.pabau.com/dr-tranter-aesthetics/online-bookings",
  enquiryForm: "https://booking.pabau.com/dr-tranter-aesthetics/capture/14",
};
