# Slowlight

Walk through three universes where one constant of nature has been turned so far that you can see what it does.

- **I. Slow Light.** In this town, light travels at 12 m/s. Run and the world folds into a bright tunnel ahead of you. Colours shift into ultraviolet and infrared, and even the 300 K warmth of stone becomes visible. The passing tram looks rotated rather than squashed (Terrell rotation), and your watch falls behind the town clock.
- **II. Big ħ.** In this courtyard, a rolled ball is a quantum wave. It spreads through a doorway, makes interference fringes through two openings, and tunnels through a glass wall. Pressing *Measure* collapses the wave to a single spot.
- **III. Big G.** Turn gravity up until a 90-tonne boulder collapses into a black hole. Then fly around it while starlight bends into arcs, an Einstein ring and a photon ring.

Each world has a guided tour, effect switches, live instruments and a **Real universe** button. That button puts every constant back to its measured value, and the strange effects vanish.

## Run on your Mac

1. Install Homebrew from https://brew.sh if you don't have it yet.
2. Open **Terminal** and run `brew install node`.
3. Download this repository: green **Code** button → **Download ZIP**, then unzip it.
4. In Terminal, type `cd `, drag the unzipped folder into the window, and press Return.
5. Run `npm install && npm start`, then open the link it prints (http://localhost:4173).

Controls: click the view to look around, use WASD to move, hold Shift to run, press N for the next tour stop. On a phone, drag the left side to walk and the right side to look. Use the **Share** button to copy a link to your exact dial settings.

## How the physics is computed

| World | Method |
| --- | --- |
| Slow Light | The scene is drawn in its rest frame into a cube map, with moving objects at their retarded (light-delayed) positions, solved per vertex. A per-pixel Lorentz boost then applies aberration. The colour shift integrates a sunlit spectrum, plus 300 K thermal glow, against the CIE 1931 observer, with D⁵ beaming. |
| Big ħ | The time-dependent Schrödinger equation is solved on the GPU with Visscher's staggered leapfrog, which conserves probability. A CPU twin of the same scheme is unit-tested against free spreading and analytic barrier tunnelling. |
| Big G | Photon geodesics in the Schwarzschild metric are ray-marched per pixel. The integrator is tested against the exact bending integral, the weak-field limit 4GM/c²b, the photon sphere at 1.5 rs and the capture radius. |

## Develop

```sh
npm run dev        # live-reloading dev server
npm test           # unit tests against textbook results
npm run e2e        # Playwright end-to-end tests in Chromium
npm run typecheck
```

GitHub Pages deploys from the default branch through `.github/workflows/pages.yml`. On a free plan, Pages only works if the repository is public.

MIT licensed.
