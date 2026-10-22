# Share links

`Share` copies a link to exactly what the visitor has set up in the current world: the tour stop, every effect switch and the dials. Opening that link enters the same world at that stop with those switches and dials, and the address bar shows the same link. Older links that carry only dials still open the first stop with those dials.

## Sub-features

- `share-copy` `Share` puts the link in the address bar and copies it, with a toast. The link names the stop (unless it is the first) and only what differs from that stop as authored: `on=` and `off=` switch lists, then dials to four significant figures.
- `share-restore` opening a link restores its stop, switches and dials, and the address bar shows the link back, keeping `&quality=` when present.
- `share-old` opening `?world=<id>&<dial>=<value>` restores that dial at the first stop.
- `share-clamp` an out-of-range, malformed or hostile value is clamped or ignored, never applied raw: with nothing valid left, the world opens at its first stop as authored.

## How to get to it (user POV)

- Choose `Share` in a world's Dials panel.
- Open a link someone sent, scan a QR code on a student sheet, or follow a link on a teacher page.

## Driving it with ctl

Preconditions:

- A desktop instance is in World I at Low quality.

- **Set a state.** Run `ctl press KeyN` five times. `tour.stop` is `6 / 12` and `tour.title` is `Terrell rotation`. Run `ctl click '.switch:has([data-toggle="doppler"])'` and `ctl click '.switch:has([data-toggle="delay"])'`, then `ctl press End '[data-dial="c"]'` and `ctl press ArrowLeft '[data-dial="c"]'` a few times. Note `toggles` and `constants.c`.
- **Share.** Run `ctl click '[data-share]'`. The URL becomes `/?world=slow-light&stop=terrell-rotation&on=doppler&off=delay&c=<value>`, with c to four significant figures, and the toast reads `Link to this universe copied` or `Copy the address bar to share this universe`.
- **Restore.** Run `ctl go "?world=slow-light&stop=terrell-rotation&on=doppler&off=delay&c=30&quality=low"`. `tour.stop` is `6 / 12`, `toggles` has `doppler` on and `beaming` and `delay` off, `constants.c` is 30, and the URL is the link with `&quality=low`.
- **Old link.** Run `ctl go "?world=slow-light&quality=low&c=50"`. `tour.stop` is `1 / 12`, `constants.c` is 50 and `ctl text '.dial-value'` reads `50 m/s`.
- **Clamp.** Run `ctl go "?world=slow-light&quality=low&c=1"`. `constants.c` is 4, the dial's minimum. Then run `ctl go "?world=slow-light&quality=low&c=abc&stop=__proto__&on=constructor"`. `tour.stop` is `1 / 12`, `constants.c` is the world's preset, 12, and the URL is `/?world=slow-light&quality=low`.
- **Other worlds.** Run `ctl go "?world=big-hbar&quality=low&hbar=0.5"`. `constants.hbar` is 0.5.
- **Proof.** Run `ctl shot share-restored` and `ctl errors`.

## Gotchas

- Headless Chromium may refuse clipboard writes; the second toast is then the expected one.
- A link is read against its stop as authored (the world's preset, the switches as declared, then the stop's own settings), not against the stops walked before it. A unit test keeps the two the same for every shipped stop, so a stop that a walk reaches with a switch changed must set that switch itself; a switch in a shared link is then one the visitor changed.
- A stop's key is its `key`, else the first four words of its title as a slug, with ħ spelt hbar (`turn-hbar-up`). Renaming a stop without setting `key` sends its old links to the first stop.
- Only the current world's switches and dials go into the link. Share leaves `&quality=` out.
