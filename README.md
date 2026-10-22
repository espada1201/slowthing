# Slowlight

Walk through three universes where one constant of nature has been turned so far that you can see what it does.

- **I. Slow Light.** In this town, light travels at 12 m/s. Run and the world folds into a bright tunnel ahead of you. Colours shift into ultraviolet and infrared, and at a full sprint even the 300 K warmth of stone becomes visible. The passing tram looks rotated rather than squashed (Terrell rotation), and your watch falls behind the town clock. Measured adds a map of where everything is, and what every clock reads, at your own now, with a spacetime diagram.
- **II. Big ħ.** In this courtyard, a rolled ball is a quantum wave. It spreads through a doorway, makes interference fringes through two openings, and tunnels through a glass wall, coming out fainter but not slower. Pressing *Measure* fires a detector in the floor, which catches the ball at one spot and leaves a lump no wider than the detector's 0.53 m resolution.
- **III. Big G.** Turn gravity up until a 90-tonne boulder collapses into a black hole. Then fly around it while starlight bends into arcs, an Einstein ring and a photon ring. Mark the edges of its shadow with the sky ruler and you can weigh it, the way the Event Horizon Telescope weighed the black hole in M87.

Each world has a guided tour, effect switches, live instruments and a **Real universe** button. That button puts every constant back to its measured value, and the strange effects vanish.

## Run on your Mac

1. Open **Terminal**. If you don't have Homebrew, paste the install command from https://brew.sh, then run the two "Next steps" lines it prints.
2. Run `brew install node`.
3. Download this repository: green **Code** button → **Download ZIP**, then unzip it.
4. In Terminal, type `cd `, drag the unzipped folder into the window, and press Return.
5. Run `npm install && npm start`, then open the link it prints (http://localhost:4173).

Controls: click the view to look around, use WASD to move and ← → to turn, hold Shift to run, and press N or B for the next or previous tour stop. In World III, R turns the sky ruler on. The **?** button lists the keys. On a phone, drag the left side to walk and the right side to look. Use the **Share** button to copy a link to the exact tour stop, switches and dials you are looking at.

Quality starts on **Auto**, which moves between presets and trims the resolution to keep the view near 60 frames a second; choose Low, Medium or High in the top bar (in the Dials panel on a phone) to keep one preset. If your system asks for reduced motion, a world opens standing still, and a tour stop that would set things moving waits for **Start**.

For a class, **For teachers →** on the title screen opens a one-page student sheet and a teacher page for each world, with the answers, a 15-minute lesson and a QR code for every activity. Print them from the published website (see below): printed from `npm start`, the codes point at your own computer, which students' devices cannot open.

## How the physics is computed

| World | Method |
| --- | --- |
| Slow Light | The scene is drawn in its rest frame into a cube map, with moving objects at their retarded (light-delayed) positions, solved per vertex. A per-pixel Lorentz boost then applies aberration. The colour shift integrates a sunlit spectrum, plus 300 K thermal glow, against the CIE 1931 observer, with D⁵ beaming. Trams and lamps are shaded all the way to your eye. In their own frame, sunlight arrives aberrated and shifted, and sky light is summed over the half of the sky each face sees. That light is carried at eight wavelengths, so it can be shifted twice: once onto the tram, then again on its way to you. |
| Big ħ | The time-dependent Schrödinger equation is solved on the GPU with Visscher's staggered leapfrog, which conserves probability. A CPU twin of the same scheme is unit-tested against free spreading and analytic barrier tunnelling. |
| Big G | Photon geodesics in the Schwarzschild metric are ray-marched per pixel. The integrator is tested against the exact bending integral, the weak-field limit 4GM/c²b, the photon sphere at 1.5 rs and the capture radius. |

## Develop

```sh
npm run dev        # live-reloading dev server
npm test           # unit tests against textbook results
npm run e2e        # Playwright end-to-end tests (first time: npx playwright install chromium)
npm run typecheck
```

To publish it as a website, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**. From then on, `.github/workflows/pages.yml` deploys the default branch on every push. Until then that workflow skips itself. On a free plan, Pages needs a public repository.

MIT licensed.
