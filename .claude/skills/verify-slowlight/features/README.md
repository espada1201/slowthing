# Slowlight verification map

This directory is the maintained source for verifying what a Slowlight visitor can do. Read this index, then use the matching feature file as the recipe.

## Baseline preconditions

- `ctl launch` has printed `"ready"` and `ctl doctor` exits 0 on this instance.
- Desktop recipes run on a default instance (1280×800). Recipes marked phone run on one launched with `VERIFY_DEVICE=phone` and its own `VERIFY_PORT`.
- Every recipe starts on the title screen (`ctl go /`) unless it says otherwise.
- Never drive an instance this run did not launch.

## Driving conventions

- Prefer ARIA roles and names, then the app's data attributes, over CSS classes or position.
- Treat quoted names, keys and selectors as literal.
- Enter worlds at Low quality. Wait with `ctl frames <n>`, never with sleeps.
- A step's result is the JSON the command prints. Compare it with the expected values named in the step.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof is a `ctl shot` and a `ctl aria` of the result, named `<feature-id>-<step>`.
- A dial, switch or share step also quotes the printed `constants`, `toggles` or URL.
- End every recipe with `ctl errors` showing 0 errors.
- Report an unreachable path with the command tried and the unmet precondition.
- Do not report an entry point as verified through a different one.

## Feature entry contract

Each file starts with an H1 and one paragraph on the visible behaviour, then four H2s in this order: `Sub-features` (short IDs, one line each), `How to get to it (user POV)` (every entry point), `Driving it with ctl` (`Preconditions:`, then labelled steps pairing an action with an exact command and the observable result) and `Gotchas`.

## Features

- [Title screen](./title.md): the three world plates, keyboard entry, back to the worlds, quality.
- [World I, Slow Light](./slow-light.md): the c dial, six effect switches, walking and running, cruise, tram, clocks, the Measured map, the level reticle.
- [World II, Big ħ](./big-hbar.md): the ħ dial, rolling a wave-ball, measuring it, the detector walls, rapid fire.
- [World III, Big G](./big-g.md): the G dial, light bending, gravitational shift, the shadow edge, flying in, the sky ruler, weighing the hole, the Einstein ring.
- [Guided tour](./tour.md): stops, keyboard and button navigation, predict-then-reveal questions.
- [Proofs page](./proofs.md): every physics check run in the browser, with measured against expected.
- [Share links](./share.md): copying a link to the current stop, switches and dials, and restoring it.
- [Phone layout](./phone.md): dials behind a toggle, quick actions, thumb walking.
- [Sound and help](./settings.md): the Sound switch, the controls help, the quality choice inside a world, Auto quality.
- [Reduced motion](./reduced-motion.md): a world opens still, and tour stops that set things moving wait for `Start`.
- [Graphics card reset](./gpu-reset.md): the message while the view is lost, and the advice to reload when it stays lost.
