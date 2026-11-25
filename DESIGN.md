# Dr Tranter Aesthetics: the design system

Rebuilt from scratch on Nov 10, 2026 (Sam: « garde rien de ce qui a été fait hier »). The first build of Nov 9 is
archived on the branch `archive/v1-premier-build`, nothing of it is used here. Source: the Figma file (Home and the
Melasma concern page, drawn at 1728 px only). The values below are read from the Figma by script, then interpreted:
design slips corrected, never redesigned.

## Where the values live
- `system/tranter.json` is the one source of the tokens: fluid sizes, floors, role tokens, text styles, fonts.
- `python3 system/gen.py` writes `src/styles/base.css` from it. Never edit base.css by hand: change the JSON and run
  the script. OP System's Variables edits come back as requests: change them in the JSON.
- `src/styles/project.css` holds the project's global classes (below).
- The style sheet page (`/style-sheet`, under Système in OP System) is generated from the same JSON.

## Scale model: two segments
- Phone 390 to tablet 1023: the phone and tablet values of each token (`--x-min`, `--x-max` in `:root`).
- Computer 1024 to 1728: everything scales with the width, as one piece (`-min = -max × 1024 / 1728`), so the
  Figma's proportions and line breaks hold on every laptop. Above 1728 the content stops growing and sits centred;
  the coloured bands stay full width.
- Floors keep reading text legible at 1024: 13 px for running text, 12 px for labels and buttons, applied with
  `max()` in the text-style rules.
- `--u` is one Figma pixel at 1728, proportional. It is kept for a few one-off composition values only, each listed
  in the component that uses it (concerns' actions, results item 04, founder id, concern head).

## Grid
- 12 columns from 64rem (1024), 8 from 48rem (768), 4 below. Margin 24 / gutter 18 at 1728; 16 / 12 on phone.
- Named lines (`.site-grid`): margin c1, inset c3, marker c4, main c5, detail c6, half c8, third c9, aside c10,
  aside-text c11, end. Tablet keeps the names on 8 columns (margin c1, inset and marker c2, main and detail c4, half
  and third c5, aside and aside-text c7; main at c3 until Nov 20); on a phone every name is at the margin.
- Components place their parts on these names, never on column numbers (`review/tools/check_build.py` checks it).
- An item of a list spans only its own columns, never the whole grid (Sam, Nov 20): OP System's Edit outlines the item,
  and what sits beside it stays reachable.

## Type
Season Collection, one variable file (`public/fonts/SeasonCollectionVF-TRIAL.ttf`), its SERF axis giving Sans (0),
Mix (50) and Serif (100). The trial file is used on the review site, as agreed for OP's internal builds; the web
licence is bought before the site goes live.

| Style | Cut | 1728 / tablet / phone | Line height | Use |
|---|---|---|---|---|
| display | Mix 420 | 59 / 34 / 30 | 1.1 | the concern list |
| h1, h2 | Sans 550, `em` in Mix 420 | 44 / 28 / 26 | 1 | page and section titles |
| h3 | Mix 420 | 32 / 20 / 20 | 1 | card titles |
| text-main | Mix 420 | 16 / 15 / 15 | 1.0888, 0.03 em | running text |
| text-serif | Serif 470 | 16 / 15 / 15 | 1 | address, role, facts |
| text-index | Sans 550 | 16 / 15 / 15 | 0.9515 | [01], treatment names (Sam: Sans Medium, the Figma had Mix SemiBold) |
| text-index-caps | Sans 550, capitals | 16 / 15 / 15 | 0.9515 | card names in capitals |
| text-date | Sans 550 | 16 / 15 / 15 | 0.9515 | journal dates |
| text-list | Sans 400 | 16 / 15 / 15 | 1.4, 0.02 em | footer lists |
| text-tight | Mix 420 | 16 / 15 / 15 | 1 | footer address and hours |
| text-note | Sans 550 | 16 / 15 / 15 | 1.0888 | product notes |
| text-label | Sans 550, capitals | 16 / 12 / 12 | 0.94, 0.02 em | labels |
| text-action | Sans 550, capitals | 14 / 12 / 12 | 1.1614, 0.04 em | buttons and links (Sam: 14, the Figma had 15) |

- No OpenType feature the Figma does not use (Sam, Nov 10): `tnum` or `case` can make some browsers drop the axis.
- Text boxes are trimmed to the cap height (`text-box: trim-both cap alphabetic`): a distance in the system is a
  distance between visible letters, as in the Figma.

## Colour and themes
Swatches: ink #2c0f0a, cream #e1dcbc, sand #ded5c2, stone #e8e7e2, mist #c2d3d7, khaki #cac3a5. Themes: light (sand
ground, the default), stone, mist, dark (ink, cream text), dark-sand (ink, sand text: the founder). Secondary text is
the theme's text at a set opacity (`--tone-*`), so it follows every ground.

## Spacing
- `space-1` to `space-11`, `section-space-small / medium / large`, band heights (`band-hero`, `band-approach`,
  `band-cta`, `band-concern`, `band-page`: a page's opening, 375 at 1728, Nov 20) from the Figma.
- Role tokens point at a step of the scale (`roles` in the JSON): `--space-media` = `space-3` (16 at 1728, 12 on
  tablet and phone) is the gap between an image and the first text of its card, everywhere (Sam, Nov 10). Change the
  step and every card follows.
- Section padding (Sam, Nov 10, 12:54): the small one everywhere, the same at the top and the bottom: `.section-padding`
  (`--section-padding` = the side margin, 24 at 1728, 16 on a tablet; on a phone the large step, 48, Sam 12:58: a role
  token may point at another step below 48rem, `phone` in the JSON). The exception, on purpose: the closing
  invitation, the journal, the products and the concern body's blocks end wide (`--section-padding-wide` =
  `section-space-large`, 128 at 1728, 64 on tablet and phone; Sam 13:10: twice the old 64, one wide bottom everywhere). The hero's top on a tablet and a phone also clears the nav. Before: five values chosen section by section.

## Global classes (`src/styles/project.css`)
`site-grid` (the grid and its named lines), `stack` (a vertical stack, gap from a space token), `at-end` (an action
against the right edge), `marker` (the small square), `inset-optical` (the optical indent of capitals),
`media` (an image box: ratio class, the picture absolute, cover, centred; ratios 5:6, 1.45, 16:10, 9:7, 7:10, 1:1;
a frame whose photo is still to come stays, empty, on `--background-skeleton`, so the composition holds: Nov 20),
`link-list` (a list of plain links: no underline, on hover, on focus and for the page shown the link slides `--space-2` right and a square 0.8 marker shows before it; with a mouse one square glides from link to link and rests on the page shown, src/utils/link-marker.ts; the menu and the footer, Nov 20 and 24), `linked-card` (a block with a photo and a link is one link: its `data-card-link` stretches over it, and its photo comes forward on hover; Card, the journal's cards, a concern page's treatment cards; Sam, Nov 24), `stacked-card` (a card's picture as wide as the card, its texts stacked: Card, the journal, the products), `section-padding` (every section's padding; 15 uses on Nov 20, the rule's ceiling: the next page that needs it calls for a look at the class), `lead-marker` (the marker leading a text where the grid has no column
for it: a tablet or a phone; Sam, Nov 10: the marker is kept at every width).

## The menu's motion (Nov 20)
- One thing at a time: the cross forms (`--hover-duration`, out curve); a curtain clips the panel open from the top
  (`--menu-open-duration` 1000 ms, `--menu-open-ease` the arrive curve) with its content drifting from `--menu-shift`
  and the photo from `--menu-image-scale`; the names and links rise from masks (`--menu-line-duration`,
  `--menu-line-delay`, `--menu-stagger`, `--menu-group-stagger`, `--menu-line-ease` smooth). Closing is quicker:
  links fade, the curtain lifts on `--menu-close-duration` 650 ms, `--menu-close-ease` travel. The bar's colours
  follow the curtain (`--menu-bar-delay`).

## The menu's button (Nov 20)
- Fixed on screen, in the theme of the section under it (colour on `--hover-duration`). Three lines to a cross in two
  steps of `--burger-duration` on the smooth curve: meet, then turn; back: unturn, then part. A larger hit area than
  its lines (`--space-4` around).
- The menu's closing: lines out under their masks on `--menu-line-close-duration`, `--menu-close-stagger` apart; the
  curtain after `--menu-close-delay`.

## The page change (Nov 20): the curtain
- The site's own (TransitionCustom.astro): the next page clipped open from the bottom up (Sam, 13:02) on `--page-arrive-duration` 1000 ms,
  `--page-arrive-ease` osmo; the page left drifts up `--page-shift` and dims to `--page-dim` on `--page-leave-*` (the same
  time and curve: one gesture). From the open menu, the curtain rises over the menu too (it leaves with its page). The same gesture as the menu's opening: one language.

## The arriving page (Nov 20)
- After the curtain: the first two sections' blocks fade and rise (`--page-enter-shift`) on `--page-enter-duration`,
  `--page-enter-ease`, `--page-enter-stagger` apart, from `--page-enter-wait` (a page change) or
  `--page-enter-wait-load` (a direct load). An opening photo settles from `--page-media-scale` on
  `--page-media-duration`, never fades. No split text, no masks on text.

## Motion added Nov 21 (Sam's picks)
- One language: what rises, rises from the bottom (the curtain); what stays, stays (the square, the menu's button); a
  photo settles in its frame (the menu, an opening, the scroll: `--media-settle-scale`); a word rolls in its place
  when its meaning changes (a group's name: `--roll-duration`); one marker travels along a list instead of each item
  showing its own (Sam, Nov 22).
- Hovers: a pill fills with the text's colour, fading in place on `--hover-duration` (Sam, comment 3, Nov 22: no
  curtain); a linked card's photo on `--media-hover-duration` to `--media-hover-scale`; the home's list moves one set
  of square, pill, frame and group name on `--follow-duration`, the photo changing inside the one frame
  (`--follow-image-duration`), the group's word rolling inside the one label; a list of links (footer, menu) moves one
  square from link to link on `--follow-duration` (src/utils/link-marker.ts). A concern's name stays on its rail and
  moves between Mix Regular and Sans Medium through the font's axes (`--cut-duration` 500 ms, `--cut-ease` the smooth
  curve: the brand guide's accent switch, quicker, Sam, Nov 24; the axis numbers are `--<style>-font-axis`).
- Filters: the page goes back to the group's top, the cards that go fade out (`--filter-out-duration`), then those that
  stay travel and those that come fade in (`--filter-duration`), measured against the list; left and right are counted
  among the cards shown (Sam, Nov 24). Loader: the starter's logo preset on `theme-dark`.
- The arriving blocks come in with the curtain, `--page-curtain-wait` after the swap, a wait set once per page change
  and never changed under them (Sam, Nov 24; it was after the whole curtain).

## Filters
- A group's filters (the Treatments page, Nov 20): pills in the buttons' text style, `--tag-y` and `--tag-x` inside
  (the Figma's 23 high at 1728), `--space-1` apart, a column under the group's name on a computer, a wrapping row on a
  tablet and a phone. The chosen one is filled with the text's colour.

## Motion
- Hover fades last 400 ms (`--hover-duration`, Sam, Nov 10: slower). A written button or link that ends with an arrow
  gives it a box of its own: on hover the arrow leaves to the right and comes back from the left (600 ms,
  `--arrow-duration`); nothing moves under reduced motion. Smooth scroll: Lenis, light.

## Responsive
- The home's opening fills the screen (`min-height: 100svh`, Sam, Nov 10, 13:13): its photo takes the room left and
  scales down when it lacks some (a size container: width = min(its columns, the room's height × 5/6)), its
  bottom-left corner fixed on its column; it never grows past its columns. Floor 12rem tall; below that the opening
  grows. The Figma's band (928 at 1728) is a 1728 × 928 screen: the Home is measured in that window. On a phone
  the photo sits in the middle of the room left and against the right edge (Sam, comment 23).
- Tablet: one section rule (Sam, Nov 20: « le titre à gauche pourrait prendre 3 colonnes… l'image à 2 colonnes à
  droite, en général… que le texte respire »). A section's title or label on the first three columns (margin to
  main); its content from column 4 (main): three columns when a picture sits beside it (main to aside), five
  otherwise (main to end); a picture beside a text on the last two (aside to end): the steps, the founder. Two cards
  side by side on two columns each (main, aside), the wide one on the three content columns; a card's name may wrap.
  What composes the whole width keeps it: the home's opening photo (four columns from main), the results scattered as
  on the computer, the card rows (left, right, centred), the footer's groups (columns 3, 5 and 7).
- Below the computer an action row is one line when it fits (the pill, then the link), on the main rail on a
  tablet, at the margin on a phone; a long link wraps under.
- On a phone an action set against the right edge (`at-end`) sits at the left, close under its title (Sam, Nov 10,
  a rule for the whole site); the nav keeps its button and menu at the right, on the logo's line.
- On a phone the hero shows its photo right after the title, then Byron Bay, the address and the phone close
  together; the footer's small print is its last line, and its groups go two by two from 30rem (480 px), where two
  columns hold the longest line.
- Phone: text full width, images alternate (3 columns left, 3 columns right, the last of a group full width), as on
  manœuvre. Cards in a row (journal, products): tablet left, right, centred; phone left, right, full.

## Corrections of the Figma (kept on purpose)
Classed by the Tranter method: a slip of 2 px or less is snapped silently; an isolated one corrected and listed; a
repeated or visible one kept as the design's intention; a doubt is a question.
- Section tops snapped to the margin or the section space; journal cards on one line; approach step 4's break kept.
- The full list with the reason of each expected deviation from the Figma: `review/data/home-target.json`.

## Checks (`review/`)
The Home measures 92 of 92 elements within 2 px of its target at 1728. `review/README.md` says how to run every
check: positions against the Figma, grid and rails at every width, type against the Figma's styles, images on the
grid, the image-to-text gap.
