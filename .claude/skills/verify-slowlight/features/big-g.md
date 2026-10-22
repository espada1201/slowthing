# World III, Big G

A platform in space where gravity is turned up until a 90-tonne boulder becomes a black hole. Light from the sky bends around it into arcs, an Einstein ring and a photon ring. The visitor can fly in, and the instruments show the hole's size, their distance and how slowly their clock runs.

## Sub-features

- `bg-dial` the G slider takes the boulder from a plain rock (real G) to a larger black hole.
- `bg-switches` `Light bending` and `Gravitational shift` change the picture; `Shadow edge` draws a dashed circle.
- `bg-face` `Face the hole` (F) turns the view to the hole.
- `bg-fly` WASD with Space and Q flies; `Your distance r` falls and `Your clock rate` drops as you approach.
- `bg-readouts` Schwarzschild radius, r / rs, `1 min here`, starlight shift and shadow size follow the dial and your position.

## How to get to it (user POV)

- Choose the Big G plate on the title screen.
- Open a shared link with `?world=big-g`.

## Driving it with ctl

Preconditions:

- A desktop instance is ready, Low quality chosen on the title screen.

- **Enter.** Choose the plate. Run `ctl click '.plate[data-world="big-g"]'` and `ctl frames 3`. `Schwarzschild radius` reads `4.5 m`.
- **Real G.** Move the slider to its minimum. Run `ctl press Home '[data-dial="G"]'` and `ctl frames 2`. `Schwarzschild radius` contains `10⁻²²` and the status contains `nothing visibly bends`. Take `ctl shot bg-real`.
- **Back to the hole.** Run `ctl click '[data-reset="preset"]'` and `ctl frames 2`. The radius reads `4.5 m` again. Take `ctl shot bg-hole`.
- **Shadow edge.** Run `ctl click '.switch:has([data-toggle="guide"])'`, `ctl frames 2` and `ctl shot bg-guide`. A dashed circle surrounds the shadow.
- **Fly in.** Face the hole and fly. Run `ctl press KeyF`, then `ctl hold Shift+KeyW 8000`. `Your distance r` falls by more than 10 m and `Your clock rate` falls below 0.94.
- **Last stop.** Run `ctl press KeyN` seven times, then `ctl frames 2`. `Your clock rate` reads about 0.414 and `Shadow` reads `73% of sky`.
- **Proof.** Run `ctl aria bg-final` and `ctl errors`.

## Gotchas

- Every pixel marches a light ray, so SwiftShader draws well under one frame a second at Low. Each `frames 2` can take several seconds.
- Big G's only dial is G; there is no c or ħ slider here.
- The tour moves you, so read distances right after the step that sets them.
