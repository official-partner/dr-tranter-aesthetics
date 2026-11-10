# Decisions

One line per decision: the date, who asked, what was decided and why. The newest at the top.

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

## 2026-11-10, the components (start, session components, asked by Samuel Charpentier)

- Built from the Web System's tokens only, each with a sample on `composantes`: `Button` (restyled: outlined pill in the
  round radius, label capitals, press feedback, the link variant with its arrow; card d-buttons), `Wordmark` (the name in
  type until the logo SVG arrives), `SiteHeader` and `SiteMenu` (sticky Burgundy bar, Book pill shortening to « Book » on a
  phone, menu panel in Mist with four lists and a photo, full screen on a phone with the Book pill fixed at the foot;
  focus moves in, the page behind is inert, Escape and a click outside close it, focus returns to the button),
  `SiteFooter` (3, 3 and 2 columns on a computer, the lists folded on a phone), `Statement` (the opening, CSS only: lines
  rise from masks once; no GSAP needed, a loading screen would hold it), `SectionHead`, `ConcernIndex` (the signature:
  a hover and focus preview, a tapped list on a phone and tablet; card c-concern-index), `StepList`, `ResultsScatter`
  (scattered on a computer, a swipe row below; Before / After switch, After by default; cards c-before-after and
  c-phone), `JournalCards` (dates day first; card c-dates), `ClosingInvitation`.
- Layout: the starter's Nav and Footer are replaced by `SiteHeader` and `SiteFooter` (the old files are gone); the skip
  link and the 404 are in English; `ClinicSchema` writes the MedicalClinic data from `src/data/site.ts`.
- Collections (card c-collections): `concerns` (15, with their group and the design's summaries), `treatments` (19, with
  their summaries, no category yet), `articles` (3, dated 22 January 2026), `results` (4). Labels in English, the
  client's language. No photos yet: the frames say « Photo to supply ».
- Global classes added: `.media-frame`, `.media-placeholder`, `.bracketed`, `.pill`, `.swipe-row` (and `.site-grid` got a
  row gap, so a phone's stacked head and body do not touch). `.marker` is now used (section labels, the hovered concern).
- Fix in the system: Sand and Mist now carry the light theme's roles (text, links, buttons); before, a Sand or Mist
  block inside a Burgundy one (the menu panel under the header) kept the Burgundy roles.
- Token added: `--logo-size` (22 to 27.5) and `--media-ratio`.
- Decided: the concern preview photo is 2 columns wide, not the design's 3, and the hovered line is above it, so the
  longest names are never covered; the photo is placed inside the list and centred on its line as far as it allows (a
  small script, delegated, no layout shift). The Learn more pill sits on the photo's foot. The group label shows in
  the left columns on the hovered line. The menu's lists are Structure, Surface, Clinic and Connect (the last two names
  are ours). Concern pages are at /concerns/<slug>, other addresses are ours (src/data/site.ts): the pages are not
  built, so those links lead to the 404 until they are. The footer keeps the design's AHPRA placeholder, flagged as
  supply. The scatter's sizes and positions are ours: only the design's idea (four cases, four sizes) is kept.
- Not built here: filter pills of the Treatments page and its empty state, the concern and treatment cards, form fields
  beyond Lumos's (they follow the pages).

## 2026-11-10, the Web System (start, session system, asked by Samuel Charpentier)

- base.css rewritten from the design (DESIGN.md, The Web System): scale model A (390 to 1728, content capped at 1728),
  grid 4 / 8 / 12 with the design's margin 24 and gutter 18, spacing from the design's own steps, four themes (Stone,
  Sand, Mist, Burgundy) with Lumos's light, dark and brand kept as aliases, no accent colour.
- Card c-scale (yes): fluid sizes in rem tokens. Card c-contrast (yes): Taupe `#654f45` and Taupe light `#7d695d` replace
  the design's `#847165` and `#a8998a`, same hue (checked by script on Sand, Mist and Stone); small print on Burgundy
  uses Dust. Card c-font (adjust, the team's note: the trial font is fine for the staging site): the trial file is still
  not committed, the files are not in the repository, so the site wears system stand-ins (`--primary-family`,
  `--serif-family`) and the licensed file replaces them with no other change.
- Card c-motion (yes): op.config.json `transition` fade, `smoothScroll` light, loader off; durations and eases named in
  base.css. `brandColor` #2C0F0A and the favicon regenerated (the initial on Burgundy) until the logo arrives.
- Decided: provisional values (h4 to h6, text-large, label tracking, nav height 4.5rem, marker 0.5rem, tablet column
  split, hover of the pill) are marked in base.css and DESIGN.md. Radii are 0 except the pill.
- Global classes added: `.site-grid`, `.column-head`, `.column-body`, `.marker` (the marker was already decided as one
  shared class, d-marker).
- Types: a `Theme` type (src/types.ts) for Section, Card and the layout.

## 2026-11-09, setup (asked by Samuel Charpentier)

- op.config.json: id dr-tranter-aesthetics, name and client Dr Tranter Aesthetics. src/consts.ts: SITE_NAME, SITE_DESCRIPTION (a plain placeholder: the Brief holds no description yet), SITE_LOCALE en. Worker name in wrangler.jsonc kept: dr-tranter-aesthetics.

## 2026-11-09, reading of the design (start, asked by Samuel Charpentier)

- Way: from scratch. Read the design in Marque (Home.pdf at 1728 px, images of the menu, Concerns, Melasma, Treatments,
  Morpheus8) and the font file. Measures, direction and motion in DESIGN.md; the decision cards, problems, improvements
  and supplies in OP System (« Lire et proposer »); the brand (provisional) and the wireframes of the 5 drawn pages in
  OP System. Only the home page goes to the page list, as the team asked.
- Font: SeasonCollectionVF-TRIAL.ttf (Displaay) forbids storage on a public server: it is never committed; the review
  site uses a system stand-in until the licensed woff2 arrives.
- Copy errors flagged, corrected at build: « Alreay know w hat youre lookin for? » (Already know what you're looking
  for?), « Ready to talk about Morpheus8 ? » (no space), footer year 2027 (the build writes the current year), AHPRA
  number MED0000000000 (placeholder, to supply).
- Proposed (cards): fluid 390 to 1728 with the content capped at 1728; phone layouts drawn by the build; collections
  concerns, treatments, articles, results; AA contrast for the secondary greys; no loader, fade transition, light smooth
  scroll; a Before / After switch; /book as the one booking address; day-first dates.
