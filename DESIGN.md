# Design

Read from the client's design (Marque in OP System: Home.pdf at 1728 px, the images of the menu, Concerns, a concern,
Treatments, a treatment, and the Season Collection font file) on 2026-11-09. No brand guide yet: every value here is
provisional until the client's guide confirms it. Decisions waiting for the team are the cards in OP System
(« Lire et proposer »); this file follows their recommendations until the team answers.

## Direction

1. **Subject.** A doctor-led cosmetic medicine clinic in Byron Bay (Dr Sarah Tranter). Its own words: structure and
   surface, assessment before treatment, judgement, the face as one system, a consultation first.
2. **Reader and job.** Someone who knows what bothers them, not the name of a treatment. The home helps them find their
   concern, then trust the doctor enough to book a consultation.
3. **Signature.** The two-weight sentence: every statement mixes Season Sans Light and Regular in one line, and the
   concern index sets 15 concerns at display size as one list where the line you point at turns dark, steps in and shows
   its photo. Phone: the same list at 28 px, tapped straight to the concern. Reduced motion: the photo appears without
   travel.
4. **Type.** One variable family used as two. Season Sans (SERF 0) for whatever names or points: headings in two weights,
   the index, labels and pills in capitals. Season Serif (SERF 100) for whatever is read: body, facts, address, hours, at
   16 px everywhere. Headings sit tight (line height 1), left aligned, broken by hand.
5. **Colour.** Four grounds as themes: Burgundy (dark, Cream text; opening, founder, footer), Sand, Mist and Stone (light,
   Burgundy text). Burgundy is also the ink. No accent colour: the outlined pill is the one action, « Book a
   consultation », in the header, after the approach and at the end of every page.
6. **Layout.** Section labels and headings hold columns 1 to 4; content starts at column 5. The rhythm changes by section:
   statement, index, steps, scattered cases, portrait, three cards, one-line invitation.
7. **Images.** Close-ups of skin for concerns and treatments, the clinic and its people for the opening, approach and
   founder. Square corners, absolute, cover. The opening photo is the LCP.
8. **Motion.** One opening per page (the statement's lines rise from their masks), the index preview on the fast curve,
   the rest simply shows. No loader, a fade between pages, a light smooth scroll (cards waiting for the team).
9. **Voice.** The client's copy, word for word: plain, measured, clinical, no promises (« Proof, not promises »).

**The generic test.** The generic aesthetics site is blush pink, a script logo, spa stock photos, a centred hero over a
face and three service cards with icons. The design already avoids it; what the build must not let drift: the
concern index must stay one large list (not a grid of cards), the statement keeps its two weights (no italic or coloured
word), and the results stay scattered on desktop (not a carousel). The bracketed numbers stay where they count a real
sequence (approach, how we treat).

### Home, desktop (1728) and phone (390)

```
Opening (Burgundy)             | phone
[logo]            [Book] [≡]   | [logo]    [Book] [≡]
            STATEMENT h1 ....  | STATEMENT h1 (28)
            [photo 4 col]      | [photo full width]
addr   tel                     | addr / tel

Concerns (Sand)                | phone
Where would you   Volume loss… | Where would you like to start?
like to start?    Jawline…     | Structure: 7 lines (28 px)
STRUCTURE ■       ■ [img] Learn| Surface: 8 lines
                  …15 lines    | [View all concerns]
     [View all]   Browse →     | Browse treatments →

Approach (Mist): heading | [01..04] steps | photo   -> phone: heading, steps, photo, buttons
Results (Stone): 4 cases scattered at 4 sizes        -> phone: swipeable row, Before/After switch
Founder (Burgundy): heading | name + bio | portrait  -> phone: heading, portrait, name, bio
Journal (Sand): heading [View all] / 3 cards         -> phone: swipeable row of 3
Invitation (Stone): label | sentence | [Book]        -> phone: stacked, pill full width
Footer (Burgundy): logo | 3 lists / visit | connect | legal / small print -> phone: folded groups
```

## Measures

| | 1728 (design) | 1440 | 390 |
| --- | --- | --- | --- |
| Columns | 12 | 12 | 4 |
| Side margin | 24 | 23 | 16 |
| Gutter | 18 | 17 | 12 |
| Concern index (display) | 59 / 65 | 52 | 28 |
| Statements, h2 | 44 / 44 | 41 | 28 |
| Article titles, h3 | 32 / 32 | 30 | 22 |
| Body (serif) | 16 / 18 | 16 | 16 |
| Lists, footer | 16 / 22 | 16 | 16 |
| Buttons, labels (caps) | 15 | 15 | 14 |
| Logo | 27.5 (« Dr » 14.7) | 26 | 22 |
| First text under a section's edge | 21 to 48 measured, 40 decided | 37 | 24 |

- Widest width: 1728. Content caps at 1728, centred; grounds run full width. Fluid range `--viewport-min: 390`,
  `--viewport-max: 1728`.
- Units: rem tokens in `src/styles/base.css`, fluid between the two ends; never `vw`. Pixel values in this file are the
  design's, for reference.
- Column starts at 1728: 24, 165, 307, 449, 590, 731, 873, 1015, 1156, 1298, 1439, 1581; content edge 1704.
- Colours: Burgundy #2C0F0A, Sand #DED5C2, Mist #C2D3D7, Stone #E8E7E2, Cream #E1DCBC. Secondary greys as drawn fail AA
  (#A8998A on Sand 1.9:1, #A59A95 on Stone 2.2:1, #847165 on Sand 3.2:1, #867563 on Burgundy 4.0:1): set to reach 3:1
  at 59 px and 4.5:1 at 15 to 16 px, same hue.
- Radii: pills fully round; images and panels square.
- Home section heights at 1728: 928, 1228, 870, 1971, 876, 807, 239, 731.

## Motion

Tokens of the starter, plus `--duration-fast: 250ms` and `--duration-base: 800ms` when the build needs them.

| Element | Move | Timing |
| --- | --- | --- |
| Opening statement | lines rise from masks, once | base, `--ease-osmo`, 0.08 between lines |
| Concern preview | photo fades and shifts 1 rem with the line | fast, `--ease-smooth`, fine pointer only |
| Menu panel | opens from the bar, lists in a short stagger | `--open-duration`, `--ease-smooth` |
| Journal and results | reveal once, opacity | base |
| Page change | fade (`"transition": "fade"`) | `--page-leave-duration`, `--page-arrive-duration` |
| Loader | none | |
| Smooth scroll | light | |

## Performance

LCP under 2.5 s and CLS under 0.1 on a slowed phone, INP under 200 ms; the site's own JS under 30 KB gzipped a page
(GSAP apart); images AVIF or WebP with `srcset`, none over 300 KB on a phone; one woff2 font file on first paint (the
licensed Season Collection variable, subset to Latin).
