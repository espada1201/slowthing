# World II, Big ħ

A courtyard where Planck's constant is turned up until a rolled ball is a quantum wave. The visitor rolls it at a doorway, two openings and a glass wall, measures it to collapse it, and watches dots build up on the detector walls.

## Sub-features

- `bh-dial` the ħ slider changes the ball's wavelength, shown in `Wavelength λ`.
- `bh-classical` at the real ħ the ball is a point that lands as one dot straight behind the opening.
- `bh-roll` `Roll ball` (F) sends the wave; `Spread Δx` and `Past the obstacle` grow.
- `bh-measure` `Measure` (M) collapses the wave to one spot.
- `bh-clear` `Clear dots` (R) empties the detector walls and the tally.
- `bh-switches` `Show wave`, `Detector walls` and `Rapid fire` each do what their labels say.
- `bh-glass` repeated rolls at the glass report `Glass: through` beside the plane-wave theory.

## How to get to it (user POV)

- Choose the Big ħ plate on the title screen.
- Open a shared link with `?world=big-hbar`.

## Driving it with ctl

Preconditions:

- A desktop instance is ready, Low quality chosen on the title screen.

- **Enter.** Choose the plate. Run `ctl click '.plate[data-world="big-hbar"]'` and `ctl frames 8`. The first tour stop sets the real ħ: `Wavelength λ` reads `4.14×10⁻³⁴ m`, `Spread Δx` reads `0 (a point)`, and the status starts with `Classical`.
- **Classical landing.** Wait for the first roll. Run `ctl frames 60` until the status contains `landed at x = 2.6 m`. `Dots recorded` reads `1`.
- **Turn ħ up.** Go to the next stop. Run `ctl press KeyN` and `ctl frames 60`. `Wavelength λ` reads `0.982 m`, the status contains `Wave on a 256² grid`, and `Past the obstacle` rises above 15%.
- **Measure.** Roll and measure. Run `ctl press KeyF`, `ctl frames 20`, `ctl press KeyM`, `ctl frames 5`, `ctl shot bh-measure`. `Spread Δx` drops to a small value, then grows again.
- **Clear.** Run `ctl click '[data-action="clear"]'`. `Dots recorded` reads `0`.
- **Glass.** Go to stop 6 (`Through glass`) with `ctl press KeyN` four times and `ctl frames 200`. `Glass: through` reads `k of n (p%)` with n above 0, next to `Theory (plane wave)`.
- **Proof.** Run `ctl aria bh-final` and `ctl errors`.

## Gotchas

- The wave is stepped in fragment shaders, which SwiftShader runs far below real time. A roll can take a minute of wall time; keep waiting with `frames`.
- Show wave draws |ψ|² as glowing light, so a frame difference mostly measures the moving crests. Compare the wave's share of the view instead (the e2e test counts vermilion pixels).
- The tour's own actions roll and measure on arrival, so a stop can change the readouts before you act.
