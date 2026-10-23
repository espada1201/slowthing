# Phone layout

On a narrow touch screen the Dials panel hides behind a `Dials` button, the two main actions sit on the tour card, the left thumb walks with a joystick and the right thumb looks around.

## Sub-features

- `phone-panel` the panel is hidden until `Dials` is tapped, and every control in it is the element a tap lands on.
- `phone-card` the tour card is at most 45% of the screen height (dvh where known) on a phone held either way and on any screen under 500 px tall; its words scroll above the button row (the row is outside the scroll), `More below ↓` shows while there is more, and the buttons stay in reach.
- `phone-quick` the world's first two actions are on the tour card, also on a phone held sideways (844×390) and at 200% zoom (any screen under 500 px tall).
- `phone-walk` dragging on the left side walks; Speed rises while the thumb is held.
- `phone-look` dragging on the right side turns the view.
- `phone-fit` nothing overflows the screen width.

## How to get to it (user POV)

- Open the app on a phone; on a touch screen `Auto` starts each world at Low.

## Driving it with ctl

Preconditions:

- A phone instance: `VERIFY_PORT=4318 VERIFY_DEVICE=phone ctl launch`. Use the same `VERIFY_PORT` on every command below.

- **Enter.** Run `ctl click '.plate[data-world="slow-light"]'` and `ctl frames 8`. World is `slow-light`.
- **Panel hidden.** Run `ctl aria phone-closed`. The `Constants and effects` panel is absent and a `Dials` button shows.
- **Open the panel.** Run `ctl click --role button --name "Dials"` and `ctl shot phone-panel`. The panel shows the c slider, `Real universe` and the switches.
- **Reset from the panel.** Run `ctl click '[data-reset="real"]'`. `constants.c` is 299792458. Then run `ctl click '[data-reset="preset"]'`: `constants.c` is 12 again. At the real c a cruise at 0.9 c reaches the edge of town in one frame and stops there (`Edge of town…`), so the next step needs the preset.
- **Quick actions.** Close the panel with `ctl click --role button --name "Dials"`, then run `ctl click '.quick [data-action="cruise"]'`. `β = v/c` rises over the next 30 frames.
- **Walk.** Run `ctl click '.quick [data-action="stop"]'`, `ctl frames 30`, then `ctl swipe 80 600 80 480 2500`. Speed is above 0 while the thumb is held.
- **Look.** If the walk left you facing a wall, run `ctl click '[data-tour-next]'`, which puts you in the open. Run `ctl shot phone-look-before`, `ctl swipe 300 400 200 400` and `ctl shot phone-look`. The view turns between the two shots.
- **Fit.** Run `ctl aria phone-final` and `ctl errors`. In the screenshots nothing is cut off at the right edge.

## Gotchas

- The touch layer ignores mouse events, so `click` cannot walk; use `swipe`.
- A swipe that starts on a button presses the button instead of walking.
- At a question with the Measured map up, the card is at most 45% of the screen and keeps `Next` in reach (it scrolls, its buttons stick); a band of the view at least 100 px tall (never less than 30% of the screen) stays clear between the instruments and the card, whatever font the words are set in: the card gives up height, not the band.
- Big ħ's quick actions are `Roll ball` and `Measure`; Big G's are `Face the hole` and `Ruler`.
