# World I, Slow Light

A town where light travels at 12 m/s. The visitor walks, runs or cruises at 0.9 c, and the view shows aberration, Doppler colour, searchlight beaming, light delay, length contraction and eye adaptation, each behind a switch. The instruments compare the visitor's watch with the town clock, and above half of c a level reticle steadies the eye.

## Sub-features

- `sl-dial` the c slider changes the speed of light between 4 m/s and the real value.
- `sl-reset` `Real universe` puts c back to 299 792 458 m/s, `World preset` back to 12 m/s.
- `sl-switches` each of the six effect switches changes the picture.
- `sl-walk` WASD walks, Shift runs, and Speed, β and γ rise.
- `sl-cruise` `Cruise` (F) accelerates to 0.9 c, `Stop` (X) halts.
- `sl-tram` `Tram` (T) brings the 0.89 c tram past within about three seconds.
- `sl-clocks` your watch falls behind the town clock while you move.
- `sl-edge` at the edge of town the status line says to turn round.
- `sl-reticle` faster than half of c, a level mark sits fixed at the centre of the view; `Level reticle` under Comfort turns it off, and the choice is remembered.

## How to get to it (user POV)

- Choose the Slow Light plate on the title screen.
- Open a shared link with `?world=slow-light`.

## Driving it with ctl

Preconditions:

- A desktop instance is ready, Low quality chosen on the title screen.

- **Enter.** Choose the plate. Run `ctl click '.plate[data-world="slow-light"]'` and `ctl frames 8`. World is `slow-light`, `constants.c` is 12, and all seven toggles (six effects and `reticle`) are true.
- **Dial down.** Move the c slider to its minimum. Run `ctl press Home '[data-dial="c"]'` and `ctl text '.dial-value'`. `constants.c` is 4 and the value reads `4 m/s`.
- **Real universe.** Choose `Real universe`. Run `ctl click '[data-reset="real"]'`. `constants.c` is 299792458 and the toast reads `Real universe: every constant at its measured value`.
- **World preset.** Choose `World preset`. Run `ctl click '[data-reset="preset"]'`. `constants.c` is 12.
- **Run.** Hold Shift and W. Run `ctl hold Shift+KeyW 4000`. Speed is above 0, `β = v/c` above 0.3, `γ` above 1.05, and `You are younger by` above `0.00 s`.
- **Cruise.** Cruise from the tour's open street, then stop and cruise by key. Run `ctl press KeyN` twice and `ctl frames 40`: the title is `Aberration` and `β = v/c` approaches 0.900. Run `ctl press KeyX` and `ctl frames 40`: `β` falls back to 0 and `ctl text '.reticle'` prints `[]`. Run `ctl press KeyF` and `ctl frames 40`: `β` approaches 0.900 again and `ctl text '.reticle'` prints `[""]` (shown, no text). Take `ctl shot sl-cruise`; it has the level mark at the centre.
- **Reticle off.** Run `ctl click '.switch:has([data-toggle="reticle"])'`, then reload with `ctl go "?world=slow-light&quality=low"`, `ctl press KeyN` twice and `ctl frames 40`. `toggles.reticle` is still false, and at `β` 0.899 `ctl text '.reticle'` prints `[]`. Click the switch again: `ctl text '.reticle'` prints `[""]`.
- **Switches.** Reopen with `ctl go "?world=slow-light&quality=low&e2e"`, press N twice and wait 40 frames (the `Aberration` stop cruises), then for each of `aberration`, `doppler`, `beaming`, `adapt`: `ctl pause on`, `ctl sample`, `ctl click '.switch:has([data-toggle="<id>"])'`, `ctl frames 2`, `ctl sample`, click it back, `ctl pause off`. Each pair of means differs by more than 4.
- **Tram.** Press T. Run `ctl press KeyT`, `ctl frames 30`, `ctl shot sl-tram`. The tram is in view; with `delay` or `contraction` switched off while paused, the picture changes visibly.
- **Proof.** Run `ctl aria sl-final` and `ctl errors`.

## Gotchas

- Aberration, Doppler colour, searchlight and eye adaptation only show while you move. Compare them during a cruise, not at rest.
- At rest c is the real value after `Real universe`, so every effect vanishes; that is the expected result, not a failure.
- Clicking a switch leaves the keyboard with the world (the app blurs the control). Arrow keys on a focused slider move the slider instead.
- Cruising runs to the edge of town after a while. Then the status line reads `Edge of town. Turn round and cruise back through it (F).`
- Pressing F at the first stop drives into the carousel hub 30 m ahead, which ends the cruise within a second; cruise from a stop that faces an open street, such as `Aberration`.
- The reticle is on screen only above 0.5 c, so walking (at most 0.45 c) never shows it; sprinting and cruising do.
