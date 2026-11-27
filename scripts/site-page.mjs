// The checks look at the page as a returning visitor sees it, and never count in the clinic's analytics:
// - the cookie choice already made (declined), so the consent banner (src/components/global/ConsentBanner.astro) stays
//   out of the pictures and the measures; `--consent` shows it, to look at the banner itself;
// - GA4's and Meta's scripts answered empty, so no check sends a visit (and none fails where the network is closed);
// - the registration strip of the home already closed for the visit (src/components/global/Registration.astro), so
//   the home is measured as the Figma draws it, its opening the full screen; `--registration` shows it.
export async function prepare(page, { args = [] } = {}) {
  await page.route(/googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|facebook\.com\/tr/, (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );
  const consent = args.includes("--consent");
  const strip = args.includes("--registration");
  await page.addInitScript(
    ({ consent, strip }) => {
      try {
        if (!consent) localStorage.setItem("dta-consent", "denied");
        if (!strip) sessionStorage.setItem("dta-registration", "closed");
      } catch {}
    },
    { consent, strip },
  );
}
