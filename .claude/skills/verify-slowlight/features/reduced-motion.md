# Reduced motion

When the visitor's system asks for reduced motion, a world opens standing still: nothing moves on its own until the first tap, click or key press, and the status line says so. A tour stop whose action sets something moving (a cruise, the tram, a roll) brings things to rest instead and offers a `Start` button that runs the action. Without the preference nothing changes.

## Sub-features

- `rm-still` a world opens still: the view and the clocks hold until a key press, tap or click, and the status line reads `Reduced motion: nothing moves until you tap or press a key.`
- `rm-start` a stop whose action moves things shows `Start`; the action waits for it, the world holds still until the next tap, click or key press, and `Start` hides once pressed.
- `rm-calm` an action that only brings things to rest (World I's `Stop`) still runs on arrival, with no `Start`.
- `rm-off` without the preference, stops run their actions on arrival and no `Start` shows.

## How to get to it (user POV)

- Turn on reduced motion in the operating system's accessibility settings, then open any world.

## Driving it with ctl

Preconditions:

- An instance launched with `VERIFY_MOTION=reduce` on its own port, such as `VERIFY_PORT=4319 VERIFY_MOTION=reduce ctl launch`. Use the same variables on every command below.

- **Still on arrival.** Run `ctl go "?world=slow-light&quality=low&e2e"`, `ctl sample`, `ctl frames 5` and `ctl sample`. The two samples are equal, `Town clock t` has not moved, and `ctl text '.status'` prints `Reduced motion: nothing moves until you tap or press a key.`
- **First key press.** Run `ctl press KeyN`, then `ctl frames 20`. The tour is at `2 / 9` and `Town clock t` runs.
- **Start waits.** Run `ctl press KeyN`. The title is `Aberration`, and `ctl text --role button --name Start` prints `["Start"]`. After `ctl frames 10`, `β = v/c` still reads `0.000`. Take `ctl shot rm-start`.
- **Start runs it.** Run `ctl click --role button --name Start`, then `ctl frames 40`. `β = v/c` rises toward 0.900 and `ctl text --role button --name Start` prints `[]`.
- **Calm stop.** Run `ctl press KeyN` four times. Each stop on the way shows `Start` with `β = v/c` back at 0.000; at `Moving clocks`, whose action is `Stop`, `ctl text --role button --name Start` prints `[]`.
- **Without the preference.** On a default instance, open the same world and press N twice: the cruise starts on arrival at `Aberration` and no `Start` shows (see tour.md, step Next by key).
- **Proof.** Run `ctl aria rm-final` and `ctl errors`.

## Gotchas

- The first N both releases the world and moves the tour on, because it is a key press like any other.
- The printed `status` is the world's own; the reduced-motion notice shows only in the status line on screen, so read it with `ctl text '.status'`.
- Arriving at a stop that waits for `Start` first runs the world's calm actions, so World I stops a cruise. World II has none, so a roll already under way holds still with the rest of the world until the next tap, click or key press.
