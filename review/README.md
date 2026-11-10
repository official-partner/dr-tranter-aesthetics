# Precision checks

The checks that hold this site to its Figma, at every width. Python 3 with Playwright (`pip install playwright`) and
a Chrome or Chromium (`/usr/bin/google-chrome` by default in the scripts). Build first (`npm run build`), then serve
`dist/`:

    python3 review/tools/serve.py dist 4802 &

Then, against `http://127.0.0.1:4802`:

| Check | Command | Expected |
|---|---|---|
| Positions against the Figma, Home, 1728 | `python3 review/tools/measure_build.py http://127.0.0.1:4802/ review/data/home-figma.json --target review/data/home-target.json --hover '[data-figma="1:83"]' --height 928` (the opening fills the window: 928 is the Figma's) | 92 of 92 within 2 px of target |
| The project's rules (no column numbers, no px, components) | `python3 review/tools/check_build.py .` | 0 failure |
| Every grid on the site grid | `python3 review/tools/grid_check.py <url> 390,768,1023,1024,1440,1728` | 0 off the grid |
| Rails proportional on the computer | `python3 review/tools/rail_check.py <url> 1024,1440` | 0 off proportion |
| Type against the Figma's styles | `python3 review/tools/type_check.py <url> review/data/home-figma.json` (or melasma-figma.json) | only the listed decisions |
| Images start and end on a column | `python3 review/tools/media_rail.py <url> 390,820,1728` | 0 off the grid |
| One gap between an image and its text | `python3 review/tools/media_gap.py <url> 390,820,1728` | one value per width |
| Captures, three widths side by side | `python3 review/tools/shoot_responsive.py <out dir> 1728,820,390` | |

- `review/data/home-target.json`: each expected deviation from the raw Figma, with its reason (a correction of the
  method, or a decision of the team with its date). A change of the design adds its line here, with its reason.
- `review/data/type-decisions.json`: the team's decisions over a Figma text style; the type check applies them and
  counts them apart.
- `data-figma` attributes in the pages tie each element to its Figma node, for these checks only.
