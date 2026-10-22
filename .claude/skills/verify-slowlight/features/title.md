# Title screen

The title screen names the app, shows three world plates (Slow Light, Big ħ, Big G), a quality choice and a link to the proofs. Choosing a plate loads that world; the world's `← Worlds` button comes back.

## Sub-features

- `title-plates` shows the heading `Slowlight` and exactly three plates.
- `title-enter` enters a world by mouse or by keyboard.
- `title-back` returns from a world to the plates, with focus on a plate.
- `title-quality` remembers the chosen quality across reloads.
- `title-error` explains in words when WebGL2 or float render targets are missing.

## How to get to it (user POV)

- Open the app's address.
- Choose `← Worlds` inside a world.
- Choose `← Worlds` on the proofs page.

## Driving it with ctl

Preconditions:

- A desktop instance is ready and `ctl doctor` exits 0.

- **Plates.** Open the title screen. Run `ctl go /` and `ctl text '.plate-title'`. Mode is `title` and the titles are `Slow Light`, `Big ħ`, `Big G`.
- **Quality.** Choose Low. Run `ctl select low --label "Rendering quality"`, then `ctl go /` and `ctl aria title-quality`. The snapshot shows option `Low` selected after the reload.
- **Keyboard entry.** Focus the first plate and press Enter. Run `ctl press Enter '.plate[data-world="slow-light"]'`, then `ctl frames 5`. World is `slow-light`, the URL is `/?world=slow-light`, and the tour title is `A town at 12 m/s`.
- **Back.** Choose `← Worlds`. Run `ctl click '[data-back]'`. Mode is `title`, world is `null`, and the URL is `/`.
- **Mouse entry.** Click the Big ħ plate. Run `ctl click '.plate[data-world="big-hbar"]'` and `ctl frames 5`. World is `big-hbar`.
- **Proof.** Run `ctl shot title-entered`, `ctl aria title-entered` and `ctl errors`.

## Gotchas

- The plates are buttons whose accessible names include the blurb, so use `.plate[data-world=…]` rather than an exact role name.
- Medium is the default except on Apple Silicon (High) and touch screens (Low). A saved choice overrides both.
- `title-error` cannot be reached in this harness, because SwiftShader provides WebGL2. Report it BLOCKED unless a browser without WebGL2 is available.
