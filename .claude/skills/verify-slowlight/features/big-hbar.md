# World II, Big ħ

A courtyard where Planck's constant is turned up until a rolled ball is a quantum wave. The visitor rolls it at a doorway, two openings and a glass wall, measures it with a detector in the floor, and watches dots build up on the detector walls.

## Sub-features

- `bh-dial` the ħ slider changes the ball's wavelength, shown in `Wavelength λ`.
- `bh-classical` at the real ħ the ball is a point that lands as one dot straight behind the opening.
- `bh-roll` `Roll ball` (F) sends the wave; `Spread Δx` and `Past the obstacle` grow.
- `bh-measure` `Measure` (M) fires a floor detector: a cyan flash where it catches the ball, which leaves the wave a lump no wider than the detector's resolution.
- `bh-clear` `Clear dots` (R) empties the detector walls and the tally.
- `bh-switches` `Show wave`, `Detector walls` and `Rapid fire` each do what their labels say.
- `bh-glass` repeated rolls at the glass report `Glass: through` beside the plane-wave theory, and `Glass: speed through`, read from the wave that got through, a touch above the ball's 4 m/s.
- `bh-fainter` the tour stop after the glass asks whether a ball that tunnels comes out slower, and its answer quotes that speed.

## How to get to it (user POV)

- Choose the Big ħ plate on the title screen.
- Open a shared link with `?world=big-hbar`.

## Driving it with ctl

Preconditions:

- A desktop instance is ready, Low quality chosen on the title screen.

- **Enter.** Choose the plate. Run `ctl click '.plate[data-world="big-hbar"]'` and `ctl frames 8`. The first tour stop sets the real ħ: `Wavelength λ` reads `4.14×10⁻³⁴ m`, `Spread Δx` reads `0 (a point)`, and the status starts with `Classical`.
- **Classical landing.** Wait for the first roll. Run `ctl frames 60` until the status contains `landed at x = 2.6 m`. `Dots recorded` reads `1`.
- **Turn ħ up.** Go to the next stop. Run `ctl press KeyN` and `ctl frames 60`. `Wavelength λ` reads `0.982 m` and the status contains `Wave on a 256² grid`. A new ħ starts a new tally, so `Dots recorded` is back to `0`. Run `ctl frames 30` until `Past the obstacle` rises above 15%: the wave reaches the doorway about 100 frames after the stop.
- **Measure.** Roll and measure. Run `ctl press KeyF`, `ctl frames 20`, `ctl press KeyM`, `ctl frames 5`, `ctl shot bh-measure`. The status contains `Detector fired at`, a cyan spot and beam stand where it fired, and `Spread Δx` drops to at most `0.53 m`, the resolution stop 5 (`A detector pins it down`) names, then grows again.
- **Glass.** Go to stop 6 (`Through glass`) with `ctl press KeyN` four times. Run `ctl frames 30` until `Glass: speed through` reads a speed: about `4.02 m/s`, never below `4.00 m/s`. Keep running `ctl frames 30` until `Glass: through` reads `k of n (p%)` with n above 0, next to `Theory (plane wave)` at `28%`; the first balls can land some 50 frames after the speed shows. The share starts high, since the balls that tunnel land first, and falls toward the theory as the reflected part comes back.
- **Fainter, not slower.** Go to stop 7. Run `ctl press KeyN`, `ctl click '.choice[data-choice="1"]'` and `ctl text '.predict-reveal'`. The reveal says what gets through `averages 4.02 m/s`, within 0.01 of `Glass: speed through`.
- **Clear.** With the glass's dots on the walls, run `ctl click '[data-action="clear"]'` (or `ctl press KeyR`). `Dots recorded` reads `0`, and `Glass: through` and `Glass: speed through` read `—`.
- **Proof.** Run `ctl aria bh-final` and `ctl errors`.

## Gotchas

- The wave is stepped in fragment shaders, which SwiftShader runs far below real time. A roll can take a minute of wall time; keep waiting with `frames`.
- Show wave draws |ψ|² as glowing light, so a frame difference mostly measures the moving crests. Compare the wave's share of the view instead (the e2e test counts vermilion pixels).
- The tour's own actions roll and measure on arrival, so a stop can change the readouts before you act.
- The detector's flash fades over 1.5 s of game time, which SwiftShader stretches to several seconds: take the shot within a few frames of Measure.
- `Glass: speed through` reads `—` until a glass roll has finished crossing, and a roll measured on its way gives no reading.
