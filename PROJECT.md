# Decisions

One line per decision: the date, who asked, what was decided and why. The newest at the top.

- 2026-11-10, Sam (comments 23 to 25, done in a conversation: the app's session stopped at its monthly ceiling, comment
  23 settled without its change): on a phone the opening's photo is centred in its room and against the right edge;
  one space between a card's text and its action link (`--space-action`); hovers slower (400 ms) and the arrow of a
  link leaves and comes back on hover.

- 2026-11-10, Sam (13:13): the home's opening fills the screen (100svh) at every width; its photo scales down from its
  bottom-left corner when the screen is short, so the whole opening shows. `band-hero` is no longer used by it. The
  measure of the Home now runs in a 1728 × 928 window (`--height 928`), the Figma's opening.

- 2026-11-10, Sam (13:10): the wide bottom is twice as large and the same everywhere: `--section-padding-wide` points
  at `section-space-large` (128 at 1728, 64 on tablet and phone); the closing invitation uses the role again instead
  of its own value. Every section that ends wide follows: the closing invitation, the journal, the products, the
  concern body's blocks.

- 2026-11-10, Sam (18:07, comment 22): the founder's title no longer adds the side margin above it on the computer
  and tablet; it starts at the section's own top padding, level with the photo.
- 2026-11-10, Sam (18:06, comments 18 to 21, melasma page): every block of the concern body and the products section
  end wide on purpose (`--section-padding-wide`); on a phone
  their label's square sits on column 1 and the label on column 2 (in place of the lead marker).

- 2026-11-10, Sam (12:54): the small section padding (the side margin) everywhere; only the closing invitation and the
  journal end wide (64 at 1728), on purpose; (12:58) on a phone the section padding is the large one (48). Replaces the
  two-value rule of 12:47. (12:56, comment 12) the small square
  marker is kept on tablet and phone: where the grid has no column for it, it leads the text it marks (`lead-marker`).

- 2026-11-10, Sam (12:47): smooth scroll on (Lenis, preset light, op.config.json). Section padding made uniform:
  two values, `.image-band` (the side margin) and `.text-section` (`section-space-medium`), in place of five chosen
  section by section from the Figma; the hero's top under the nav and the footer are the two exceptions (DESIGN.md).

- 2026-11-10, Sam (11 comments in OP System, 12:31 to 12:36, tablet and phone): applied as rules of the system, not
  one-off fixes: `--space-stack` for stacked blocks; `at-end` at the left on a phone; action rows on one line below
  the computer; the approach on the main rail on a tablet with its image on 3 columns; results 03 at the right edge
  on a tablet; the hero's photo after its title on a phone, the phone number close to the address; the nav's button
  and menu on the logo's line; the footer's small print last and its groups two by two from 30rem. DESIGN.md says each.

- 2026-11-10, Sam (12:04, « garde rien de ce qui a été fait hier… mets ta nouvelle version dedans »): the site is
  rebuilt from scratch from the precision build test of Nov 9 to 10. The first build (Web System, components, home,
  collections, wireframes and brand of Nov 9) is archived on the branch `archive/v1-premier-build` and nothing of it
  is used. The base is the starter and its setup (commit 16a62e2). The system: DESIGN.md.
- 2026-11-10, Sam: the CMS from scratch, five collections, each with a reason (CLAUDE.md, Content): `concerns` (a page
  each, `/concerns/<slug>`, and listed on the home and in the footer; a concern gets its page once its opening
  statement is filled, Melasma today), `treatments` (pages to come, named by the concern pages), `products` (listed on
  several concern pages), `articles` (pages to come, the three latest on the home), `results` (the home and the
  results page to come). The home's other lists are blocks of the page (the approach steps, marked for Modifier).
  The concern page's factors and steps are lists inside the item: Contenu shows them read only, Claude edits them.
- 2026-11-10, Sam: decisions over the Figma, logged in DESIGN.md and review/data: buttons tighter and their text at
  14; index and treatment names in Sans Medium; one gap between an image and its text (`--space-media`, 16 at 1728);
  image bands padded top and bottom like the side margin; Products padded the same top and bottom; tablet and phone
  layouts on the grid (tablet keeps the computer's composition, phone alternates the images).
- 2026-11-10, Claude: the footer's year is the current year (the Figma said 2027); the page-not-found is the site's
  own, in English; the trial Season file is served on the review site, as agreed for OP's internal builds (licence
  before launch). The site's description is a stand-in to confirm with the clinic: « Doctor-led cosmetic medicine in
  Byron Bay, planned around the whole face. »
- 2026-11-10, Claude: to supply, as before: the logo as SVG (the one in src/assets/logo is taken from the Figma),
  final photos and their rights, real before and after pairs, the AHPRA number (MED0000000000 is a placeholder), the
  booking tool, social addresses, the articles' real dates and texts, the products' own photos (the Figma shows
  another brand's packaging).

- 2026-10-28, Sam (20:07 and 20:15: Contenu v2, every change a draft): the staging reads what OP publishes;
  OP System's frame sends its draft proof (`x-op-draft`) with each page it asks for, the middleware renders the page
  within it (src/utils/draft.ts, AsyncLocalStorage, `nodejs_als` in wrangler.jsonc) and the loader hands it on to
  OP_CONTENT_URL, its answer kept apart by proof. A request without the proof never sees a draft (checked with
  wrangler dev: three overlapping requests, two proofs and none, each its own answer). Nothing to set on Cloudflare.

- 2026-10-28, Sam (16:58, « je ne veux pas que mes sites soient inondés de collections »): a collection only where a
  CMS is needed: items with a page of their own (a template, the blog's case) or the same items listed on several pages
  and managed as data. Every other list (a section's cards, offers, values, prices, partners, logos) is a block of its
  page, written in the page or in src/data/ and marked for OP System's Modifier (`data-op-list`, `data-op-source` the
  file it is written in, `data-op-item`), where the team and the client duplicate, delete and move its items on the
  canvas, as a Webflow component's slots. CLAUDE.md, Content, says it for every site made from this starter; Sani went
  from 34 collections to 3 the same day.

- 2026-10-27, Sam (23:01, « vas-y », after Amélie Haeck: the « Grille » drew 12, 8 and 4 on a site of 7, the favicon
  and the SEO of the current site lost): `--site-columns` is the grid's only name, declared per screen in base.css
  (4, 8 and 12, Lumos's Grid breakpoints) beside the margin and the gutter; without it site.json's `grid.columns` is
  null (OP System says the site declares no grid), and the build warns on a page grid laid on another variable. A
  redo keeps the current site's icons (op.config.json `"favicon": "site"`, favicon.mjs leaves them), its SEO word for
  word (`seoTitle` on a layout, `seoTitle`, `seoDescription` and `ogImage` written in a collection's schema), its verification metas (`verification`) and
  its addresses (`redirects` written as 301s in dist/_redirects, `addresses` checked at the build).

- 2026-10-27, Sam (« Contenu » wave 1, GO; from the spike `live-staging-spike`, its report in op-system): the staging is
  live. Cloudflare's build of `review` (`WORKERS_CI_BRANCH`, or `OP_LIVE=1`) uses `@astrojs/cloudflare` 14.3.4 (pinned:
  14.4 asks for Astro 7.4; Astro stays 7.3.8 so main's output and Sani's version stay as they are; both move together
  later) and renders every page but the 404 on demand (integrations/op-live.mjs); main and every other branch build
  static, their files byte for byte as before (checked against main: index, 404, CSS, _headers, robots, sitemap).
  Pages read collections through `getItems()`/`getItem()` (src/utils/content.ts): OP's working copy on the staging
  (src/live.config.ts, made from content.config.ts's own `collections`, so a collection the app adds needs no other
  edit), the files elsewhere and whenever OP does not answer in 1.5 s; visible items only, sorted by `order`. Answers
  kept 2 s, read again at once on `?op-v` or `x-op-content-version`; a failure remembered 5 s; a wrong version costs
  one read; an item the schema refuses shows its file. Pictures in OP's storage only from `OP_STORAGE_ORIGINS`, with
  their size so nothing is fetched at render. The staging's pages get the static files' headers (noindex, the secure
  headers) and no-store. `<When>` (src/components/system/When.astro) for a field that may be empty, `data-op-when` and
  `data-op-field` for OP's bridge. The sample collection `team` (every field optional but `name`, `visible`, `order`,
  labels in French), its card `CardTeam` and the page `test-contenu` (out of search engines, under Système).
  Sam, 21:25: the app writes content.config.ts and the folders itself when the team adds a collection or a field, so
  content.config.ts keeps the simple form its parser reads and nothing else goes in it. `keep_vars` in wrangler.jsonc.

- 2026-10-27, Sam (15:28: « le nouveau site Astro peut créer ses propres global classes… pour la scalabilité »; OP's
  skills rewritten for Lumos for Astro the same day, op-system's docs/DECISIONS.md): a site's own global classes live
  in `src/styles/project.css`, imported in the patterns layer after Lumos's `patterns.css`, so a component's own CSS and
  the utilities still win over them and an upgrade of Lumos never touches them; each has a one-line comment that the
  build gives OP System (site.json `system.classes`: the components' classes by prefix, then the global ones, the
  project's first with their comment and their uses). Empty in the starter.

- 2026-10-27, Sam (night plan, Bloc 8d: « optimiser les documents pour Claude, sans perdre l'info importante »;
  decided by Claude overnight, Sam asleep): CLAUDE.md says each rule once and without its history: the dates and who
  asked left the rules whose date does not serve them (their history is in this file), « How to build with Lumos » and
  « Lumos for Astro is not Lumos for Webflow » point to AGENTS.md, which every session loads with CLAUDE.md and says
  both, and the pointer to op-system's README follows its move to `docs/` (`docs/bridge.md`, `op:reveal`). No rule
  changed: a script found every rule-like line of CLAUDE.md and AGENTS.md before in the two after (op-system's night
  report). AGENTS.md is Lumos's own file, as its authors publish it: unchanged.

- 2026-10-27, Sam (Oct 26: Lenis, page transitions with three simple presets or one Claude makes from an idea, a
  loading screen, each per project; decided by Claude overnight, Sam asleep): the finishing touches are op.config.json
  keys, each `false` or a preset: `loader` mark, counter or curtain (`true` stays the mark), `transition` fade, slide or
  curtain on Astro's own router (never Barba, which would fight it; `transitions: true` stays the slide),
  `smoothScroll` light, medium or strong (Lenis, loaded only where it runs: not with reduced motion, not on a touch
  screen unless `smoothScrollTouch`), and `custom` for the site's own file Claude makes. site.json announces each with
  the presets the site has, so OP System's « Expérience » can show, replay and ask for them. The curtain wears
  `.theme-brand`; the counter counts toward 90 while the page loads, then to 100. site.json no longer announces a
  transition only because PageTransitions.astro holds `<ClientRouter />`: the built pages say whether the router is on,
  and Lenis is listed among the libraries only where it runs. The Slider answers OP System's `op:reveal`.

- 2026-10-18, Sam (« est-ce que ça pourrait être plus rapide… aussi seamless que Webflow », then « go pour tout »): OP
  System's « Mettre en ligne » puts the site live itself through its GitHub App (main moved to the version seen on the
  staging, a fast-forward only), with a bar to the site itself; a request to Claude only when the App is not on the
  repository, done from the connector's guide (`get_guide("astro")`, Live), the one source of those steps. The launch
  writes `domain` and `live` in op.config.json, and `SITE_URL` reads `domain` from it.

- 2026-10-18, Sam: `npm run shot` (scripts/shot.mjs) takes the built pages as full-page PNGs at the widths asked, with
  no browser downloaded, and CLAUDE.md (Check what you changed) says which pages to look at by what changed, at the
  comment's width and at 390, before a change is called done. A session had lost three turns on its own screenshots
  (Playwright missing, a wrong first picture, a window too tall) and had not looked at the phone width.

- 2026-10-17, Sam (« je te fais confiance pour les décisions »): a new site starts from OP System's « Un nouveau site »
  (Cloudflare's Deploy button on this repository, which must be public for it; by hand until then), then a request of
  kind `setup` to Claude. The team's « Mettre en ligne » in OP System is the ask to publish (requests `publish` and
  `launch`, the only queue work that reaches `main`). Every build serves secure headers and fails when `dist/` holds a
  secret key, so a key never reaches the published site. Design and motion follow OP's craft (the connector's guides
  `direction` and `critique`, or OP's skills). Wrangler 4.135 at least, for `wrangler preview`.

- 2026-10-17, Sam (« un loading screen par projet et un langage de transition entre les pages, comme Barba, intégré
  dans l'UX de l'app »): every site has a loading screen and page transitions ready, both off until the team turns
  them on in op.config.json (`loader`, `transitions`), so OP System can show and replay them. The loading screen wears
  the site's mark on its ground, once per tab session; the transitions are Astro's view transitions (the page lifts
  away, the next one rises in, on the site's eases), a crossfade with reduced motion. Each is restyled per client.

- 2026-10-17, Sam: the starter wears OP System's look, not Lumos's (no Lumos logo, colours, cover or showcase page;
  the credit in README.md and LICENSE only). The swatches, themes and first page are replaced with the client's.
- 2026-10-17, Sam: the site starts from OP's starter `official-partner/op-astro` (Lumos for Astro 1.0.0). `main` is
  the live site, `review` the one OP System shows; content in files until a CMS is decided.

## 2026-11-09, setup (asked by Samuel Charpentier)
- op.config.json: id dr-tranter-aesthetics, name and client Dr Tranter Aesthetics. src/consts.ts: SITE_NAME, SITE_DESCRIPTION (a plain placeholder: the Brief holds no description yet), SITE_LOCALE en. Worker name in wrangler.jsonc kept: dr-tranter-aesthetics.

## 2026-11-10, comment 13 (asked by Samuel Charpentier)
- CardRow: on phones (under 48rem, landscape included) every card spans 3 of the 4 columns, odd cards left, even cards right; the third card is no longer full width. The products on the concerns pages and the journal cards on the home follow.

## 2026-11-10, comments 14 and 15 (asked by Samuel Charpentier)
- Footer: on every phone width the groups go two by two (the threshold at 30rem removed), the small print last.
- CtaBand (closing invitation, every page): its bottom is `--section-space-large`, twice the wide end on a computer (64 px instead of 48 on a phone).
- IndexList (comment 16): on phones the number sits on the first column and the text on the three others (a subgrid, as on a computer); the tablet keeps its plain column. The steps and the "What is happening" factors of the concerns pages follow.
- StepsSection (comment 17): on phones the picture starts on the second column, under the steps' text.

## 2026-11-10, comment 26 (asked by Samuel Charpentier)
- ConcernsHome (home, "Where would you like to start?"): on tablet and computer the concerns list starts under the title (its own row, `--space-7` below it) instead of beside it, so a concern's group shown on hover ("Structure") never lands on the title. Phones unchanged.
