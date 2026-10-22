# Share links

`Share` copies a link to the visitor's exact dial settings in the current world. Opening that link enters the same world with the same dials, clamped to each dial's range.

## Sub-features

- `share-copy` `Share` puts the world and its dial values in the address bar and copies it, with a toast.
- `share-restore` opening `?world=<id>&<dial>=<value>` restores that dial.
- `share-clamp` an out-of-range or invalid value is clamped or ignored, never applied raw.

## How to get to it (user POV)

- Choose `Share` in a world's Dials panel.
- Open a link someone sent.

## Driving it with ctl

Preconditions:

- A desktop instance is in World I at Low quality.

- **Change a dial.** Run `ctl press End '[data-dial="c"]'`, then `ctl press ArrowLeft '[data-dial="c"]'` a few times. Note `constants.c`.
- **Share.** Run `ctl click '[data-share]'`. The URL becomes `/?world=slow-light&c=<value>` with four significant figures, and the toast reads `Link to this universe copied` or `Copy the address bar to share this universe`.
- **Restore.** Run `ctl go "?world=slow-light&quality=low&c=50"`. `constants.c` is 50 and `ctl text '.dial-value'` reads `50 m/s`.
- **Clamp.** Run `ctl go "?world=slow-light&quality=low&c=1"`. `constants.c` is 4, the dial's minimum. Then `ctl go "?world=slow-light&quality=low&c=abc"`. `constants.c` is the world's preset, 12.
- **Other worlds.** Run `ctl go "?world=big-hbar&quality=low&hbar=0.5"`. `constants.hbar` is 0.5.
- **Proof.** Run `ctl shot share-restored` and `ctl errors`.

## Gotchas

- Headless Chromium may refuse clipboard writes; the second toast is then the expected one.
- A dial value from the link applies after the tour's first stop, which sets the preset first.
- Only the current world's dials go into the link.
