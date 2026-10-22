# World III, Big G

A platform in space where gravity is turned up until a 90-tonne boulder becomes a black hole. Light from the sky bends around it into arcs, an Einstein ring and a photon ring. The visitor can fly in, and the instruments show the hole's size, their distance and how slowly their clock runs. A sky ruler measures the angle between any two points of the view, and one tour stop asks the visitor to weigh the hole with it.

## Sub-features

- `bg-dial` the G slider takes the boulder from a plain rock (real G) to a larger black hole.
- `bg-switches` `Light bending` and `Gravitational shift` change the picture; `Shadow edge` draws a dashed circle.
- `bg-face` `Face the hole` (F) turns the view to the hole.
- `bg-fly` WASD with Space and Q flies; `Your distance r` falls and `Your clock rate` drops as you approach.
- `bg-readouts` Schwarzschild radius, r / rs, `1 min here`, starlight shift and shadow size follow the dial and your position.
- `bg-ruler` `Ruler` (R; in the panel, and on the tour card on a phone) puts a layer over the view: two clicks or taps mark two points of the sky and show the angle between them, a third starts again, and Esc or R turns it off.
- `bg-ruler-keys` with the ruler on, the arrows move a cross out from the middle of the view (10 px with Shift) and Enter marks.
- `bg-weigh` tour stop 5, `Weigh the hole`, asks for rs and M from the shadow's size. The instruments show only `Your distance r` until `Check` or `Just show me`; the reveal gives the true values and how far off each typed answer was.
- `bg-weigh-sideways` on a phone held sideways (844×390) the weighing card keeps below the middle of the view and scrolls, so the shadow, `Your distance r` and the top bar stay clear of it; the ruler is in the panel behind `Dials`.
- `bg-ring` tour stop 6, `Einstein ring`, gives the ring's size, 20.2°, beside the 18.1° of the usual formula √(2rs/r).

## How to get to it (user POV)

- Choose the Big G plate on the title screen.
- Open a shared link with `?world=big-g`.

## Driving it with ctl

Preconditions:

- A desktop instance is ready, Low quality chosen on the title screen.
- For **Ruler by touch**, a phone instance (see phone.md).
- For **Weigh the hole held sideways**, a sideways instance: `VERIFY_PORT=4320 VERIFY_DEVICE=sideways ctl launch`, with the same `VERIFY_PORT` on every command for it.

- **Enter.** Choose the plate. Run `ctl click '.plate[data-world="big-g"]'` and `ctl frames 3`. `Schwarzschild radius` reads `4.5 m`.
- **Real G.** Move the slider to its minimum. Run `ctl press Home '[data-dial="G"]'` and `ctl frames 2`. `Schwarzschild radius` contains `10⁻²²` and the status contains `nothing visibly bends`. Take `ctl shot bg-real`.
- **Back to the hole.** Run `ctl click '[data-reset="preset"]'` and `ctl frames 2`. The radius reads `4.5 m` again. Take `ctl shot bg-hole`.
- **Shadow edge.** Run `ctl click '.switch:has([data-toggle="guide"])'`, `ctl frames 2` and `ctl shot bg-guide`. A dashed circle surrounds the shadow.
- **Fly in.** Face the hole and fly. Run `ctl press KeyF`, then `ctl hold Shift+KeyW 8000`. `Your distance r` falls from 38.5 m by more than 10 m and `Your clock rate` falls from 0.9397 to below 0.92. A frame moves you at most 0.05 s of game time, so where a frame takes over a second an 8 s hold flies only a few metres: hold for 20000 ms instead, or hold again.
- **Ruler by keyboard.** Run `ctl press KeyR`. The toast reads `Ruler: tap or click two points to measure the angle between them`. Run `ctl press Enter`, `ctl press Shift+ArrowRight` twelve times, then `ctl press Enter`. `ctl text '.ruler-angle'` prints `["12.96°"]`: two points 120 px apart across the middle of the view. Take `ctl shot bg-ruler`. Run `ctl press Escape`; `ctl text '.ruler-angle'` prints `[]`.
- **Weigh the hole.** Run `ctl press KeyN` four times and `ctl frames 3`. `tour.title` is `Weigh the hole`. `ctl text '.readouts'` prints only `Your distance r` and `80 m`, and `ctl text '.tour-text'` prints `[]`. Take `ctl shot bg-weigh`.
- **Answer.** Type rs = 4 and M = 9e4: run `ctl press 4 '[data-ask="rs"]'`, then `ctl press 9`, `ctl press e` and `ctl press 4`, each with `'[data-ask="M"]'`. Run `ctl click '[data-check]'` and `ctl frames 2`. `ctl text '.predict-reveal'` starts `Yours: rs = 4 m (0.0% high), M = 90,000 kg (0.0% high).`, and `ctl text '.readouts'` lists every instrument again. Take `ctl shot bg-weighed`.
- **Einstein ring.** Run `ctl press KeyN` and `ctl frames 2`. `tour.title` is `Einstein ring` and `ctl text '.tour-text'` mentions `20.2°` and `18.1°`.
- **Last stop.** Run `ctl press KeyN` three times, then `ctl frames 2`. `Your clock rate` reads about 0.414 and `Shadow` reads `73% of sky`. The stop asks a prediction, so the visitor sees these only after answering: run `ctl click '.choice[data-choice="2"]'`, then `ctl text '.readouts'`.
- **Ruler by touch.** On the phone instance, choose the plate, then run `ctl click '[data-tour-next]'` four times and `ctl frames 3` to reach `Weigh the hole`. Run `ctl click '.quick [data-ruler]'`, then tap the shadow's left and right edges on its middle row with `ctl swipe 151 357 151 357` and `ctl swipe 239 357 239 357`. `ctl text '.ruler-angle'` prints `["14.58°"]`, within 0.1° of twice the shadow's 7.27° radius. Take `ctl shot bg-ruler-touch`.
- **Weigh the hole held sideways.** On the sideways instance, choose the plate, then run `ctl click '[data-tour-next]'` four times and `ctl frames 3` to reach `Weigh the hole`. Take `ctl shot bg-weigh-sideways`: the card fills the bottom half and scrolls, and the shadow, `Your distance r` (`80 m`) and the top bar sit above it. Run `ctl click --role button --name "Dials"`, `ctl click '.panel [data-ruler]'` and `ctl click --role button --name "Dials"` again, then tap the shadow's edges on its middle row with `ctl swipe 389 146 389 146` and `ctl swipe 455 146 455 146`. `ctl text '.ruler-angle'` prints `["14.57°"]`. Answer as in **Answer**: `ctl press` and `ctl click` scroll the card to the boxes and `Check`, and `ctl text '.predict-reveal'` starts the same. Take `ctl shot bg-weighed-sideways`.
- **Proof.** Run `ctl aria bg-final` and `ctl errors`, on each instance.

## Gotchas

- Every pixel marches a light ray, so SwiftShader draws well under one frame a second at Low. Each `frames 2` can take several seconds, and on a busy machine `ctl shot` can time out after 30 s; `ctl aria` still records the state.
- Big G's only dial is G; there is no c or ħ slider here.
- The tour moves you, so read distances right after the step that sets them.
- The probe's `readouts` lists every instrument even while the weighing stop hides them; read what the visitor sees with `ctl text '.readouts'`.
- With the ruler on, clicks and taps on the view mark the sky instead of looking around; turn it off to look.
- Held sideways, the instruments that come back after `Check` run down behind the weighing card from about `1 min here`; the card is kept to the bottom half so that the shadow stays clear.
