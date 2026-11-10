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
  aside-text c11, end. Tablet keeps the names on 8 columns (margin c1, inset and marker c2, main and detail c3, half
  and third c5, aside and aside-text c7); on a phone every name is at the margin.
- Components place their parts on these names, never on column numbers (`review/tools/check_build.py` checks it).

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
  `band-cta`, `band-concern`) from the Figma.
- Role tokens point at a step of the scale (`roles` in the JSON): `--space-media` = `space-3` (16 at 1728, 12 on
  tablet and phone) is the gap between an image and the first text of its card, everywhere (Sam, Nov 10). Change the
  step and every card follows.
- A band whose image touches its edge has the same padding top and bottom as the side margin (Sam, Nov 10).
- A section keeps the same padding top and bottom unless a reason is noted (Sam, Nov 10: Products).
- `--space-stack` = `space-10` (64 on tablet and phone) is the space between two stacked blocks: cards in a row
  once they stack, the results on a phone, the results' rows on a tablet (Sam, Nov 10: « faire respirer »).

## Global classes (`src/styles/project.css`)
`site-grid` (the grid and its named lines), `stack` (a vertical stack, gap from a space token), `at-end` (an action
against the right edge), `marker` (the small square), `inset-optical` (the optical indent of capitals),
`media` (an image box: ratio class, the picture absolute, cover, centred; ratios 5:6, 1.45, 16:10, 9:7, 7:10, 1:1).

## Responsive
- Tablet keeps the computer's composition on the 8-column rails, with the fewest changes: no image wider than 6 of
  8 columns, lists beside their image, the results scattered as on the computer. A list sits on the main rail (c3)
  like the concerns; the approach is title | list (c3, 3 columns) | image (3 columns at the right edge).
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
