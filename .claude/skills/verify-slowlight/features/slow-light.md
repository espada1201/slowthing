# World I, Slow Light

A town where light travels at 12 m/s. The visitor walks, runs or cruises at 0.9 c, and the view shows aberration, Doppler colour, searchlight beaming, light delay, length contraction and eye adaptation, each behind a switch. The instruments compare the visitor's watch with the town clock, and above half of c a level reticle steadies the eye. `Measured` adds a map of where everything is and what every clock reads at the visitor's now, in their own frame, with a spacetime diagram along their motion.

## Sub-features

- `sl-dial` the c slider changes the speed of light between 4 m/s and the real value.
- `sl-reset` `Real universe` puts c back to 299 792 458 m/s, `World preset` back to 12 m/s.
- `sl-switches` each of the six effect switches changes the picture.
- `sl-walk` WASD walks, Shift runs, and Speed, β and γ rise (the instruments gloss them: `β = v/c` share of c, `γ` clock slow-down).
- `sl-define` β and γ in the instruments are buttons named `β (beta): your speed as a share of light's speed` and `γ (gamma): how many times slower a moving clock runs`; hover, focus or a tap shows the sentence under the instruments on every screen size (the two-word glosses hide under 500 px tall), and Esc puts it away. The same two sentences end the `?` list.
- `sl-cruise` `Cruise` (F) accelerates to 0.9 c, `Stop` (X) halts.
- `sl-tram` `Tram` (T) brings the 0.89 c tram past within about three seconds.
- `sl-clocks` your watch falls behind the town clock while you move.
- `sl-edge` at the edge of town the status line says to turn round.
- `sl-reticle` faster than half of c, a level mark sits fixed at the centre of the view; `Level reticle` under Comfort turns it off, and the choice is remembered.
- `sl-measured` `Measured`, beside Sound (on a phone, on the tour card), shows the map and the diagram, tags the view `Seen`, and folds the panel behind `Dials`.
- `sl-measured-rest` at rest the map's tower clock reads the `Town clock t` readout, the diagram shows the tower's light 5.4 s older, and a tram car measures 3.22 m.
- `sl-measured-cruise` at a steady 0.9 c (tour stop `Whose now?`) each street clock 20 m further ahead reads 1.5 s later; stopping (`Stopping`) makes them all read the town clock again.
- `sl-measured-carousel` at the carousel the map's eight lamps flash together, every 0.885 s.
- `sl-measured-words` for screen readers, which skip the text drawn inside an image, the map is in words after it: a list `On the map` with each clock on the map and its reading (the tower first), then the tram cars and the lamps, each with where it is from you; after the diagram, the tower's reading at your now and in the light reaching you. The words change at most once a second and are never announced; the `Seen` tag is for the eye only.

## How to get to it (user POV)

- Choose the Slow Light plate on the title screen.
- Open a shared link with `?world=slow-light`.

## Driving it with ctl

Preconditions:

- A desktop instance is ready, Low quality chosen on the title screen.

- **Enter.** Choose the plate. Run `ctl click '.plate[data-world="slow-light"]'` and `ctl frames 8`. World is `slow-light`, `constants.c` is 12, and all seven toggles (six effects and `reticle`) are true.
- **Dial down.** Move the c slider to its minimum. Run `ctl press Home '[data-dial="c"]'` and `ctl text '.dial-value'`. `constants.c` is 4 and the value reads `4 m/s`.
- **Real universe.** Choose `Real universe`. Run `ctl click '[data-reset="real"]'`. `constants.c` is 299792458 and the toast reads `Real universe: every constant at its measured value, and every effect back on.`, and every effect switch is on
- **World preset.** Choose `World preset`. Run `ctl click '[data-reset="preset"]'`. `constants.c` is 12.
- **Run.** Hold Shift and W. Run `ctl hold Shift+KeyW 4000`. Speed is above 0, `β = v/c` above 0.3, `γ` above 1.05, and `You are younger by` above `0.00 s`.
- **Define.** Run `ctl click --role button --name "β (beta): your speed as a share of light's speed"` (on the phone and sideways instances a tap). `ctl text '.sym-tip'` prints the same sentence; `ctl press Escape` hides it (`ctl text '.sym-tip'` prints `[]`). Do the same for γ. Take `ctl shot sl-define`; on the sideways instance the sentence sits under the instruments, over the top of the tour card.
- **Cruise.** Cruise from the tour's open street, then stop and cruise by key. Run `ctl press KeyN` twice and `ctl frames 40`: the title is `Aberration` and `β = v/c` approaches 0.900. Run `ctl press KeyX` and `ctl frames 40`: `β` falls back to 0 and `ctl text '.reticle'` prints `[]`. Run `ctl press KeyF` and `ctl frames 40`: `β` approaches 0.900 again and `ctl text '.reticle'` prints `[""]` (shown, no text). Take `ctl shot sl-cruise`; it has the level mark at the centre.
- **Reticle off.** Run `ctl click '.switch:has([data-toggle="reticle"])'`, then reload with `ctl go "?world=slow-light&quality=low"`, `ctl press KeyN` twice and `ctl frames 40`. `toggles.reticle` is still false, and at `β` 0.899 `ctl text '.reticle'` prints `[]`. Click the switch again: `ctl text '.reticle'` prints `[""]`.
- **Switches.** Reopen with `ctl go "?world=slow-light&quality=low&e2e"`, press N twice and wait 40 frames (the `Aberration` stop cruises), then for each of `aberration`, `doppler`, `beaming`, `adapt`: `ctl pause on`, `ctl sample`, `ctl click '.switch:has([data-toggle="<id>"])'`, `ctl frames 2`, `ctl sample`, click it back, `ctl pause off`. Each pair of means differs by more than 4.
- **Tram.** Press T. Run `ctl press KeyT`, `ctl frames 30`, `ctl shot sl-tram`. The tram is in view; with `delay` or `contraction` switched off while paused, the picture changes visibly.
- **Measured.** Reopen with `ctl go "?world=slow-light&quality=low&e2e"`, then run `ctl click --role button --name "Measured"` and `ctl frames 4`. `ctl aria sl-measured` lists the images `Map of the town at your now, in your frame: …` and `Spacetime diagram along your motion: …` and the `Measured` button as pressed. After the map comes the list `On the map`: `Tower clock reads 10:08:…, 53 m ahead`, then street clocks, tram cars (`Tram car 3.22 m long, …`) and lamps, each so many metres `ahead` or `behind` and `left` or `right`; after the diagram, `The tower clock reads … at your now, and … in the light reaching you.` `ctl text '.m-car'` prints `3.22 m`, the tram car nearest you, contracted from 7.2 m. `ctl text '.seen-tag'` prints `Seen the light reaching you now`, and `ctl text '#panel'` prints `[]` until `ctl click --role button --name "Dials"`.
- **Measured at rest.** Press N until `tour.title` is `Seen and measured` (six presses from the first stop), then run `ctl click --role button --name "Just show me"`. Run `ctl pause on`, then `ctl text '.m-map [data-clock="tower"]'`: the same time as `Town clock t` in the printed readouts. `ctl text '.m-diagram [data-clock="tower"]'` prints the tower's reading at your now and the one its arriving light shows, 5.4 s apart (±0.1 s from rounding; 64.8 m at 12 m/s). Take `ctl shot sl-measured-rest`, then `ctl pause off`.
- **Measured carousel.** Run `ctl press KeyN`: `tour.title` is `Moving clocks` and the map stays on. Take `ctl shot sl-measured-carousel-1`, `ctl frames 6`, `ctl shot sl-measured-carousel-2`: in each, the eight lamp dots on the map are the same size and shade.
- **Measured cruise.** Run `ctl press KeyN` and `ctl click --role button --name "Just show me"`: `tour.title` is `Whose now?` and `β = v/c` reads 0.900 at once (the stop coasts north from z = 250 m at full speed). Run `ctl frames 50` twice (each wait gives up after 60 s), which coasts you to about z = 120 m, then `ctl pause on`, `ctl text '.m-map [data-clock="street-1"]'` and `ctl text '.m-map [data-clock="street-2"]'` (the street clocks at z = 100 and 80 m): the second, further ahead, reads 1.5 s later (±0.1 s). Take `ctl shot sl-measured-cruise`.
- **Measured stop.** Still paused, run `ctl press KeyN` and `ctl frames 2`: `tour.title` is `Stopping`, `β = v/c` is 0.000, and the same two labels both show the minutes and seconds of `Town clock t`. Take `ctl shot sl-measured-stop`, then `ctl pause off`.
- **Measured on a phone.** On a phone instance in World I, run `ctl click '.quick [data-view="measured"]'` and `ctl frames 4`. The map and diagram fill the top of the screen above the readouts and the tour card, nothing spills sideways, and the top bar has no `Measured` button. Opening `Dials` takes the map out of the way until it is closed again. Take `ctl shot sl-measured-phone`.
- **Proof.** Run `ctl aria sl-final` and `ctl errors`.

## Gotchas

- Aberration, Doppler colour, searchlight and eye adaptation only show while you move. Compare them during a cruise, not at rest.
- At rest c is the real value after `Real universe`, so every effect vanishes; that is the expected result, not a failure.
- Clicking a switch leaves the keyboard with the world (the app blurs the control). Arrow keys on a focused slider move the slider instead.
- Cruising runs to the edge of town after a while. Then the status line reads `Edge of town. Turn round and cruise back through it (F).`
- Pressing F at the first stop drives into the carousel hub 30 m ahead, which ends the cruise within a second; cruise from a stop that faces an open street, such as `Aberration`.
- The reticle is on screen only above 0.5 c, so walking (at most 0.45 c) never shows it; sprinting and cruising do.
- `ctl aria` also prints the text drawn inside the map and the diagram, after each image; screen readers skip an image's contents and read the words after it instead.
- A map label is left out when it would overlap another or fall off the map, so `ctl text` prints `[]` for a clock out of range or a tram car whose label has no room; the tower is labelled first.
- While a tour stop asks its prediction the map is hidden with the other instruments.
- Pressing F from rest swings your now while you speed up: for a moment the clocks behind you run backwards on the map. Read the cruise numbers once β is steady.
- A cruise along the middle of the avenue (x = 0) stops at the carousel's hub; the tour's cruises and coast run 4 m to the east of it.
