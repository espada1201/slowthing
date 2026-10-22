# Teaching kit

`For teachers →` opens `teach.html`, the kit's own page, with no 3D view. For each world it offers a one-page student sheet and a teacher page, both built from the world's guided tour. The sheet has name lines, before-and-after questions, and per activity a QR code, its stop number, the prediction as tick boxes and lines to write on; it holds no answers. The teacher page has the syllabus codes, a timed 15-minute lesson, every answer with the tour's own reason, every stop's link with `Copy all links`, the switches, and how to hand links out.

## Sub-features

- `kit-index` `teach.html` lists the three worlds, each with `Teacher page` and `Student sheet`.
- `kit-sheet` `?sheet=<world>`: one page on A4 or Letter, one QR code per activity, no answers or reasons. A measurement (World III's `Weigh the hole`) prints its question and a blank for each quantity.
- `kit-guide` `?guide=<world>`: steps whose minutes add up to 15, each prediction's answer and reason, a measurement's steps, misconceptions and prompts. Its `Print` prints the teacher page; `Student sheet to print for the class` beside it opens the sheet.
- `kit-links` each activity's QR code or link opens its stop with that stop's switches and dials; Share then writes the same link.
- `kit-copy` `Copy all links` copies one line per stop, `<n>. <title>: <link>`.
- `kit-bad` any other query, or an id that is not a world, shows the index.

## How to get to it (user POV)

- Choose `For teachers →` on the title screen.
- Open `teach.html`, `teach.html?sheet=<world>` or `teach.html?guide=<world>`.
- Scan a QR code on a printed sheet, or open a link from the teacher page.

## Driving it with ctl

Preconditions:

- A desktop instance is on the title screen.

- **Open.** Run `ctl click '[data-teach]'`. The URL is `/teach.html`; `ctl text '.world h2'` prints the three world titles.
- **Sheet.** Run `ctl go teach.html?sheet=slow-light`, then `ctl text '.activity h2'` and `ctl text '.activity .stop'`. Each activity reads `Stop <n> of <N>`. `ctl text '.sheet'` contains no `Answer:`.
- **Guide.** Run `ctl go teach.html?guide=slow-light`, then `ctl text '.step .meta'`: the minutes add up to 15. `ctl text '.answer'` and `ctl text '.why'` print one answer and one reason per prediction.
- **Copy.** Run `ctl click '[data-copy-links]'`, then `ctl text '.copied'`. It reads `Copied <N> links.` (or says copying is blocked).
- **Activity link.** Run `ctl text '.step a.link'`, then `ctl go '<first link>&quality=low'`. `tour.title` is the activity's title and `toggles` match the stop as authored. `ctl click '[data-share]'` leaves `url` at the same link.
- **Bad id.** Run `ctl go teach.html?sheet=__proto__`. `ctl text '.world h2'` prints the three titles.
- **Proof.** Run `ctl shot kit-sheet` and `ctl aria kit-sheet` on the sheet, `ctl shot kit-guide` on the guide, then `ctl errors`.

## Gotchas

- ctl cannot print. e2e/kit.spec.ts checks the PDF page count at A4 and Letter, and that nothing lies outside the 190 × 259 mm box in print media.
- The sheet loads its QR encoder only for `?sheet=`; the app and the other kit pages never download it.
- A world's path is its stops with `lesson.minutes`. A world with none uses its predictions, at most six, sharing 15 minutes.
- QR codes encode absolute links to wherever teach.html is served, so a sheet printed from a local build points at localhost.
- A kit page draws just after it loads (`body[data-ready]` marks the end). If `ctl text` prints `[]` straight after `ctl go`, run it again.
