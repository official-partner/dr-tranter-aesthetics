# Decisions

One line per decision: the date, who asked, what was decided and why. The newest at the top.

- 2026-11-23, Sam (comment C2, Nov 22: « un copier-coller des titres donne du texte tout en capitales »): the sources
  were already right (every title typed in its own case, the capitals text-transform's: the starter's new rule
  caps-typed finds none here); the capitals came from the browser, which copies a text as its style shows it. The
  layout now carries the starter's `CopyCase` (src/components/system/CopyCase.astro): a copy from the page gives the
  words as written. Checked in Chromium: « ALLER AU CONTENU » on screen, « Aller au contenu » copied.
- 2026-11-23, Claude (seen while checking C2): the skip link said « Aller au contenu » on this English site (the
  starter's French default); it now speaks the site's language (SITE_LOCALE): « Skip to content ».
- 2026-11-21, Sam (10:29, « un petit bug vers la fin de l'animation de transition, les éléments finissent pas leur
  animation, lag »): two causes, both fixed. The arriving blocks' wait was read from an attribute the router takes away
  when the curtain ends: the wait changed under the running animations and they jumped ahead. And the blocks came in
  under the curtain, so the page change ended in the middle of their fade, the browser's busiest moment. Now one thing
  at a time: the blocks are paused while the page change runs and come in on the page itself, `--page-enter-wait`
  (80 ms) after the curtain. The curtain is 1100 ms on a new curve with a shorter tail (`--ease-curtain`), so the top
  of the page is not left empty. Sampled frame by frame: the largest step of a block's opacity between two frames went
  from 0.19 to 0.07.
- 2026-11-21, Sam (« tu peux faire aussi tes idées : 1, 3, 4, 5, 6, 7, 8 », not 2, the sections' reveal on scroll):
  - 1, photos: every photo settles in its frame as it comes into view, from `--media-settle-scale` (1.12) to its
    size, led by the scroll (a CSS scroll timeline, no script; browsers without it show the photo still).
  - 3, cards: a card that links brings its photo forward in its frame on hover (`--media-hover-scale` 1.04,
    `--media-hover-duration`), and its link's arrow passes. The Treatments cards have no link yet, so they do not move.
  - 4, pills: a pill's ground rises from the bottom on hover and focus, as the page's curtain does
    (`--fill-duration`), its words taking the page's colour as it passes; it drops back quicker.
  - 5, the square and the name, with Sam's note (« ça reste le même élément… un switch de texte entre structure et
    surface »): between two groups that follow each other (Structure then Surface on Concerns, Featured then Filter by
    on Treatments) the square never leaves the line, and the name's word rolls to the next group's when that group's
    ground reaches it (`--roll-duration`), up going down the page, down coming back. From a tablet up.
  - 6, filters: the cards travel to their new places when a filter is chosen (the browser's view transition,
    `--filter-duration`); those that go fade out, those that come fade in. Immediate without view transitions.
  - 7, loading screen: on, the starter's logo preset on the dark brand ground (op.config.json `"loader": "logo"`,
    `"loaderTheme": "dark"`), once per tab session. On the home it covers at 100 ms, leaves at 1.07 s, gone at 1.96 s,
    layout shift 0.006; the page's opening waits under it.
  - 8, the home's list of concerns, Sam's reading of it (« les éléments sont les mêmes : le bouton, le carré, la
    photo ; ils se déplacent et changent »): on hover the square, the « Learn more » pill, the photo's frame and the
    group's name travel from the last row to the new one instead of each row showing its own (`--follow-duration`);
    the photo changes inside the travelling frame; the group's word rolls only when the group changes; the concern's
    name slides to its place and its weight follows. Each row still holds its own set in the page, so it works without
    the script, with the keyboard, and the build's measure still reads it. A mouse on a computer only; not under
    reduced motion. I read « au scroll » as moving down the list with the pointer: to confirm with Sam.
- 2026-11-20, Sam (14:53, « peaufiner l'anim de transition, animer la page qui apparaît, les éléments… doux, bien
  dosé, seamless », no split text with masks): the page that arrives now opens softly. It drifts up into place inside
  the curtain; the blocks of its first two sections come in one after the other as the curtain's edge passes them (a
  fade and a rise of `--page-enter-shift`, 1400 ms on the smooth curve, 90 ms apart, from 680 ms; the second section
  three beats after the first). An opening photo never fades (the page's largest paint): it settles from a 1.08 zoom
  in its frame, as the menu's photo does. A page loaded directly opens the same way, from 120 ms. The curtain itself
  is a little slower (1200 ms). Reduced motion: none of it. All in TransitionCustom.astro, every value a token.
- 2026-11-20, Sam's comment 1 (Concerns, « partout où on a ce style : le texte et le petit carré de gauche sticky au
  scroll »): new global class `pinned`. A group's name (with its filters on Treatments) and its square stay in view
  while the group scrolls by, level with the menu's button (`--pinned-top`), from a tablet up; on a phone the name is
  above its cards and scrolls with them. On CardGroup (Concerns, Treatments) and CtaBand. Not on a concern page's
  blocks: there the name sits on a card's caption line, under the block's title, and has nowhere to travel.
- 2026-11-20, Sam's comment 2 (« un petit background sous l'icône menu quand je l'ouvre, bug ? »): a bug. The theme
  class the button takes from the section under it also painted that section's ground on the button; it showed while
  the menu's colour came in. The button takes the text colour only now.
- 2026-11-20, Sam (13:17, three asks on the menu):
  - « le texte du menu disparaît trop vite au close »: closing, the names and links now leave upward under their
    masks, in the order they came (600 ms each, 14 ms apart), and the curtain lifts after them (220 ms later, 800 ms).
    Before: a 240 ms fade. Opened from further down the page, the bar's logo and pill fade in and out with the menu.
  - « rendre le bouton menu sticky au scroll, couleur selon la section »: the menu's button stays on screen at every
    scroll, where the bar puts it (a stand-in keeps its place in the bar; the design's node 1:69 is measured on it). It
    takes the theme of the section under it (the section's `theme-*` class, the light sand where there is none), so
    it reads on light and dark grounds; the menu's colours while the menu is open. Only the button: the logo and the
    pill still leave with the bar.
  - « l'anim entre 3 lignes et X »: two steps. The outer lines meet on the middle one, which closes on its centre, then
    they turn into the cross; closing runs it back (`--burger-duration` 380 ms a step, the second starting at 70 %).
    A fault found on the way: while the menu opened or closed, a rule for the bar's colours replaced the lines' own
    transition, so the cross snapped back to three lines. Fixed.
- 2026-11-20, Sam (13:06, « mieux synchroniser la fermeture du menu… la nouvelle page et son overlay pourraient être
  par-dessus le menu »): from the open menu, the next page's curtain rises over the menu itself, which dims and drifts
  with the page it belongs to. No separate lift of the menu, so nothing to synchronise; `--page-menu-delay` is gone.
- 2026-11-20, Sam (13:02, « je ferais peut-être l'inverse : balayage de bas en haut »): the page change's curtain
  rises from the bottom instead of coming down from the top; the page left drifts up. From the open menu, the page and
  the menu now travel the same way (up). Same tokens.
- 2026-11-20, Sam (12:33, his pick of three proposals: « 1. Le rideau… pense aussi à la transition avec le menu
  ouvert »): the page change is the site's own (op.config.json `"transition": "custom"`,
  src/components/system/TransitionCustom.astro), in place of the starter's slide. The next page is uncovered from the
  top by a curtain (a clip, 1000 ms, the arrive curve) over the page left, which drifts down `--page-shift` and dims to
  `--page-dim`; no coloured panel between. The bar is part of its page (no longer held still): its colours change as
  the curtain's edge passes. From the open menu: the curtain runs under the menu and shows below it first, then the
  menu lifts off the next page (`--menu-close-duration` after `--page-menu-delay` 420 ms), its bar fading as the lift
  reaches it. Reduced motion or no view transitions: a short crossfade. `--page-arrive-delay` is gone with the slide.
- 2026-11-20, Sam (12:14, « les transitions entre les pages, style Barba, smooth, simple, seamless »): the page change
  is on, the starter's slide (op.config.json `"transition": "slide"`, Astro's router, never Barba). The page fades
  and lifts a little (400 ms, smooth curve); the next one waits until it has left (`--page-arrive-delay` 220 ms, the
  site's own addition: never the two pages at once) and rises into place (800 ms, the arrive curve). The bar holds
  still when it is on screen; scrolled down, or with the menu open, it leaves with its page and the next page's bar
  fades in at the top. A link of the open menu: the menu leaves with the page it covers, no closing first. Back and
  forward mirror the slide; reduced motion crossfades.
- 2026-11-20, Sam (12:00, « un clip masque et un peu plus lent… un look premium, pas cheap et rapide »): the menu's
  motion redone. A curtain uncovers the panel from the top (a clip, 1000 ms on the arrive curve) while its content
  drifts down into place and the photo settles from a 1.12 zoom (1600 ms); once the curtain is well down, each group's
  name and links rise from their masks in reading order (1000 ms each, 32 ms apart, groups 70 ms apart, from 380 ms).
  The cross forms at once (the click's answer) and the bar takes the menu's colours as the curtain passes under it.
  Closing: the links fade first, then the curtain lifts (650 ms), the bar's colours back as it passes. Every value is
  a `--menu-*` token (system/gen.py). Reduced motion: it shows and goes at once. The photo loads as soon as the button
  is approached. Before: the panel slid down whole in 240 ms.
- 2026-11-20, Sam (« vas-y avec prêt maintenant », step 3): the Treatments page at `/treatments`, from the Figma frame
  59:983 as it is in the file today (photos, a featured block, the filters), measured 72 of 72 on its target
  (review/data/treatments-figma.json, treatments-target.json). The bank's « Treatments - Overview page.png » is an
  earlier state (no photos, no featured block); Simon's brief confirms the updated Figma has both, so the file wins.
  - The collection holds the 19 treatments of Simon's brief (his paths as slugs: Medical Facials is
    `signature-facial`), in the Figma's order (Weight Loss Consultation first), each with three new fields: `intro`
    (its card on this page, the Figma's text word for word), `category` (the filters: Injectables, RF treatments,
    Laser & light, Facials & peels, from Simon's table) and `featured` (the block at the top).
  - Featured: Weight Loss Consultation, Cosmetic Treatments, Biostimulators and FaceTite, as the Figma shows them.
    Simon's brief still asks which ones (« Featured treatments: which treatments, on the home and on the overview? »):
    one tick per item in Contenu changes it.
  - « All treatments » shows the treatments not featured above (the Figma's 15); a category shows all of its own,
    featured or not, so Injectables is never empty. The chosen pill is filled with the text's colour (the Figma draws
    no chosen state); the count is said to screen readers.
  - No card links yet: no treatment has its page (the template comes later), the rule of the Concerns page. Each row is
    about 41 shorter than the Figma's until the links come.
  - Not in the Figma, decided here: the featured block on the light sand (the Figma's band has no colour the connector
    gives; the page itself is mist, as in the bank's picture). One prop to change if the Figma says otherwise.
  - Copy corrected: FaceTite's « for dramatic, visible non-surgical change » promised a result; now « tightening tissue
    beneath the surface without surgery ». Question for Simon if he wants other words.
  - `ConcernGroup` became `CardGroup` (any collection, with filters when asked); the Concerns page uses it as before.
    `CtaBand` takes its label and its pill. `PageHead` takes the mist ground, and its title is now five columns with
    balanced lines (the Figma's boxes were 567, 600 and 637 wide on three pages; the Concerns title had a fourth line
    the Figma does not have, now three as drawn).
  - Three treatments share one stand-in photo (Cosmetic Treatments, FaceTite, EMFACE), placed with the Volume loss page;
    the others wait on an empty frame. Photos are the team's to choose.
- 2026-11-20, Sam (« vas-y avec prêt maintenant », step 2): the menu. The nav's button opens it on every page, from the
  Figma frame « Menu nav » (59:191): a mist panel slides down under the bar, the bar takes its colours and the three
  lines become a cross. Four groups: Structure and Surface (the concerns of the collection, in their order, each marked
  for Edit), The Clinic and Connect; the approach photo on the right on a computer, none on a tablet or a phone (the
  links need the room). It closes on the cross, Escape, the scrim or a link; the page behind is inert and still (Lenis
  stopped), focus goes to the first link and back to the button.
  - The links of the menu and the footer come from one file, `src/utils/site-links.ts` (a link written once), and share
    the new global class `link-list` (no underline; on hover the link moves a little right and a small square shows
    before it, as the Figma's hover).
  - Not in the Figma, decided here: the panel's foot on a tablet and a phone mirrors its top (no photo ends it there).
  - A link whose page is not built yet (Results, Our team, The Clinic, Journal, Contact, Careers) and the
    social links (no address given yet: Facebook, Instagram, LinkedIn) point to the home, as the footer did; each gets
    its address with its page or its URL.
- 2026-11-20, Sam (« vas-y avec prêt maintenant »): the Concerns page at `/concerns`, from the Figma frame 59:602,
  53 of 53 on its target (review/data/concerns-figma.json, concerns-target.json). Every concern by group, each card from
  its item: its photo, its name, its new field `summary` (the Figma's card text, kept word for word), a link only once
  the concern has its page (no link to an empty page; the rows keep one height so the rhythm holds).
  - New: `Card` (a photo at 1.45, a name in capitals, a line, a link) and `ConcernGroup`; the global class
    `stacked-card` (a card's picture as wide as the card, its texts stacked), now also the journal's and the products'
    cards (the same rule was in two components); `PageHead theme` (stone here).
  - A page's opening ends wide (--section-padding-wide), the same on every page, in place of `band-page` (the Figma
    draws 375 on Our Approach and 253 here): Our Approach's opening is 51 shorter.
  - Photos as the Figma's overview places them, where the site has them at the design's size (the forehead, the skin
    with a pale line, the skin texture: six concerns); the other three photos of the overview (the green eye, the
    neck, the freckled skin) wait for the frame's export, their frames empty. The bank's PNGs come to a session at
    38 % and the session's network does not reach the app's files: an export placed in the repository, or the Figma
    connector once its plan allows, gives them whole. Melasma keeps its own photo.
  - The Figma's corrections: Surface's name and square 34 to the right of Structure's, brought to the margin and the
    marker rail; both groups start 36 down, at the section padding (24) here; rows space-8 apart (the Figma 79).

- 2026-11-20, Sam (11:06, « revoir les layouts de tablettes en général… le titre à gauche pourrait prendre 3 colonnes.
  L'image… 2 colonnes à droite… que le texte respire »): one section rule on a tablet, made in the grid (DESIGN.md,
  Responsive): the tablet's main rail moves from column 3 to 4, so every title placed « margin to main » takes three
  columns and the content starts at column 4; a picture beside a text takes the last two (the steps of the home, Our
  Approach and a concern; the founder's portrait); a concern's two cards sit on two columns each, the recommended one
  on three, a long name wrapping (COSMELAN / DERMAMELAN at 768); the concern head's name on the content columns and
  its crumb against the edge, its facts on the content; a page's opening on the content columns with its square on the
  marker rail, as the home's. Kept where they were: the home's opening photo, the results, the card rows' centred
  card (columns 3 to 6), the footer's groups (3, 5, 7). The founder's bio keeps space-7 from her name (the smaller
  portrait left the grid no height to spare: the two touched). The computer is unchanged: home 92 of 92, Our Approach
  31 of 31; 0 failure at the nine widths; looked at in 800 and 1000 on the home, Our Approach, Melasma, Volume loss.

- 2026-11-20, Sam (« les items, quand je les édite, prennent la pleine largeur de l'écran »): an item of a list is as
  wide as what it shows, never the whole grid. IndexList's items spanned the 12 columns (1680 at 1728) with their texts
  placed on their own columns, so in Edit an item's outline covered the title and the text beside it and took their
  clicks (the focus list, the steps of Our Approach and the home, a concern's factors and steps). The list now sits on
  its own columns (the number on main, the text on the two after it, ending before the half rail where Our Approach's
  wide photo starts: Sam, 10:54; the aside list to the end) and its items fill it. Checked by script: no item's box
  over anything outside it on the home, Our Approach and Melasma at 1728, 1280, 1024, 900 and 390 (the home's hover
  photos excepted: hidden at rest, over their neighbours only while shown, as drawn). Measured the same (home
  92 of 92, Our Approach 31 of 31), 0 failure at the nine widths.

- 2026-11-20, Sam (« enchaîne avec approach »): Our Approach at `/approach` (Simon's path), from the Figma frame 59:828,
  measured 31 of 31 on its target (review/data/approach-figma.json, approach-target.json, each difference with its
  reason). The footer's « Our approach » and the home's « Learn more » go there.
  - New in the system: `band-page` (375 at 1728, the opening's band on a computer); `PageHead` (a page's opening under
    the nav, its square centred on the title's capitals); `TextSection` (a title, its text on the main rail, an
    unnumbered list or a link on the right: a concern's « What is happening » composition); `IndexList numbered={false}`;
    `StepsSection wide` (the photo from column 8 to the edge) and `endWide`; `CtaBand theme` (light sand after a mist
    band, as drawn); the nav's colours follow the page's opening (`navTheme`: light on sand).
  - Fixed for every page: StepsSection kept the home's action-row tracks with no actions, three empty gaps (144 at
    1728) under « How we treat » on the concern pages. It now ends at the section padding, as Sam's rule says.
  - The Figma's copy corrected: « the most effective non-surgical protocols » becomes « the right… »; « We adopt
    whichever protocol gives the closest result to surgery, without it » becomes « We choose each protocol for how well
    it tightens the lower face without surgery » (no superlative, no comparison with surgery: Simon's A5); « Kensington
    considers the face… » becomes « We consider the face… », and its missing comma. Question for Simon: the « Structure,
    Surface and Cohesion » text repeats the Assessment step word for word.
  - The photo is a stand-in cut from the Figma's render at 67 % of its size (the Figma connector reached its plan's
    limit of calls): `public/img/approach-hands.jpg`, to replace with the frame's export at full size.
  - The mist band is 88 shorter than drawn: the steps end wide (--section-padding-wide) where the Figma leaves 240.

- 2026-11-20, Sam (« la phrase d'ouverture en texte mis en forme »): a concern's opening statement is a formatted text,
  Markdown as OP System's Contenu writes it (*words* in italics are the lighter cut), read by `inlineRich`
  (src/utils/rich.ts, the app's own reading). Melasma and Volume loss converted; the page renders as before. Left to the
  app: the field's kind « Formatted text » is kept in OP's arrangement, set in the app (its worker's `type` op), not in
  the site; until it is set Contenu shows the field as plain text with its asterisks.

- 2026-11-20, Sam (« ces pages-là, c'est des pages de template CMS… voir qu'est-ce qui manquerait »): the concern
  pages tied to OP System as a CMS template, before more of them are built. Static pages come next; the other concern
  and treatment pages wait for the app's Contenu and Edit passes.
  - The build says its templates (site.json `collection` and `item` on each page made from a collection, `templates`
    from op.config.json: `concerns` is « Concern »), as on Curveball, Amélie Haeck and Sani since Nov 18
    (`templateRoutes`, taken from Curveball's integration).
  - The factors and the steps are Contenu's « Rows » (Nov 20): each row has an `id` and its cells a label; Melasma's
    and Volume loss's rows got theirs. Before, they were lists Contenu showed read only.
  - OP System's « Draft » (the starter's, Nov 12): `draft` on the concerns, `STAGING` in src/utils/content.ts, site.json
    `content.drafts`. A draft shows on the staging only; the live build leaves it out, its page with it.
  - Marked for Contenu and Edit (23 fields where there were 5): the facts, the factors and steps as rows of the item
    (`astro:concerns/<id>#factors`, `#steps`, the starter's Sections form), the steps' photo, the line under the
    related concerns, and the treatment cards as the treatments' own items (their name, summary, photo).
  - Not done: the opening statement still holds `<em>` in a plain text, which Contenu shows as tags (to try with the
    kind « Texte mis en forme »); the app's Edit writing into a collection's rows from the page is step 11 of its
    plan, not built yet, so those marks wait for it.

- 2026-11-20, Sam (Simon's « CLOP master brief » of Nov 19 for the content, the method of Nov 10 for the build; the
  new Figma file « Tranter (Client) », same design as the first one, other node ids): the site's pages are declined
  one at a time, each shown to Sam before the next. First page: Volume loss and hollowing on the concern template.
  - Slugs follow Simon's paths (`/concerns/volume-loss`, `jawline-and-chin`, `skin-laxity`, `expression-lines`,
    `pigmentation`, `redness`, `texture-and-scarring`, `congestion`, `dullness`, `neck-chest-hands`,
    `weight-management`; treatment `cosmelan`). Nothing was live: no redirect.
  - Sam: the blocks Simon's brief leaves empty on a concern (the recommended starting point, « How we treat » in four
    steps) get placeholder copy in the brand's tone, drawn from Simon's text: the first treatment he lists is the
    starting point. Placeholders for Sarah to rewrite.
  - Photos as the Figma places them, all stand-ins: a concern's opening photo is its card's on the Concerns overview
    (the design repeats about six photos over fifteen concerns); a treatment's is its card's on the Home or a
    treatment page (Cosmetic Treatments, FaceTite and EMFACE share one in the Figma); « How we treat » keeps the
    template's photo. Exported at the design's size (the session's network does not reach figma.com: the Figma
    connector's render). A product with no photo yet keeps its frame, empty (DESIGN.md, Global classes).
  - Simon's copy corrected and listed: the statement takes the Concerns overview's version (« among the earliest
    signs », not « one of the most treatable »: no superlative); the factors' grammar (« develop », « progress », « occur »,
    the comma splices); « before the skin itself changes: the effect is structural ». Simon's tag (« Changes in facial
    volume ») has no place in the design: not shown. Consultation length and « Assessed by » as on Melasma, to confirm.
  - New: treatments Cosmetic Treatments, FaceTite, EMFACE (Simon's descriptors); products Peptide Firming Complex and
    Barrier Repair Moisturiser (name only: no text, no photo). Treatments ordered as Simon lists them.
  - Claude: inside a sentence a concern's name starts in lower case (« How we treat volume loss and hollowing »,
    « Ready to talk about melasma? »); the Figma capitalised Melasma there.

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


## 2026-11-12, the starter's checks (asked by Samuel Charpentier, « GO! lance ca! »)
- The site takes the starter's four checks (`npm run rules`, `measure`, `widths`, `compare`), its shot script (it
  waits for every image, whole) and the rule check in the build. Nothing of the site changes: compared before and
  after, 5 pages of HTML, 10 pictures and 18 presses the same.
- The home measures 92 of 92 on its target (`npm run measure -- accueil --hover '[data-figma="1:83"]'`). Comment 26
  (the concerns list under its title) had moved 8 elements about 123 px off the target: the decision is now in
  `review/data/home-target.json` with its date. The target also loses one entry of the first method (1:81: a text is
  placed by its first letter now) and names its window (1728 by 928).
- Four failures of the rules are accepted, each with its reason (`review/data/rules-baseline.json`): the nav's layer
  written as a number, the team's two tool components.
- Not done here: the system file in the starter's new form (system/tranter.json and gen.py stay as they are), the
  short CLAUDE.md, the type and image-gap checks (still `review/tools/type_check.py` and `media_gap.py`).

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
