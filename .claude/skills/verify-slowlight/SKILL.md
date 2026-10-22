---
name: verify-slowlight
description: Drive the real Slowlight web app (title screen, the three worlds, the proofs page, share links, phone layout) in a headless browser and capture evidence. Use to prove a Slowlight change works for a visitor, or to check every entry in the feature map.
---

# Verify Slowlight

Slowlight is a browser app: a title screen, three worlds (Slow Light, Big ħ, Big G) drawn with WebGL2, and a proofs page. A visitor clicks, presses keys, drags sliders or swipes. This skill launches a fresh production build, drives it from one long-lived headless Chromium, and saves screenshots, ARIA snapshots and readouts as evidence.

Every command runs from the repo root through one script. Below, `ctl` stands for:

    node .claude/skills/verify-slowlight/scripts/ctl.mjs

## Launch

- Needs `npm install` once and Playwright's Chromium: `npx playwright install chromium` on a Mac. In the cloud container, export `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and never install.
- `ctl launch` runs `npm run build`, serves `dist/` with `vite preview` on port 4317, starts headless Chromium with software WebGL (SwiftShader, as CI does) and opens the title screen. It prints `"ready"` once the three world plates are on screen. `ctl launch --no-build` reuses the current `dist/`.
- One instance per port. For another instance at the same time (a parallel checker, or the phone layout), set `VERIFY_PORT`; the browser's debug port is `VERIFY_PORT + 1000`. `VERIFY_DEVICE=phone` makes it a 390×844 touch phone instead of a 1280×800 desktop, and `VERIFY_DEVICE=sideways` the same phone held sideways, 844×390. `VERIFY_MOTION=reduce` makes its browser ask for reduced motion, as the operating system setting does.
- State and evidence live in `$VERIFY_DIR`, by default `<os tmp>/verify-slowlight-<port>/`.

## Doctor

`ctl doctor` is read-only. It prints JSON and exits 1 unless all of these hold: the server and browser this instance started are up, the port serves this checkout's `dist/index.html`, nothing in `src/` is newer than that build, the page has the `window.slowlight` probe, and the browser has WebGL2 with float render targets. It also counts console errors so far. Run it first, and again whenever anything looks off. A stale build means `ctl cleanup`, then `ctl launch`.

## Drive

Each command connects to the running browser, acts, and prints what the visitor can now see: URL, mode, world, frame count, constants, tour stop, switch states, readouts, status line, toast, the graphics card reset message (`gpuReset`) and proofs summary.

| Command | What it does |
| --- | --- |
| `go <query>` | Open a URL relative to the app, such as `go "?world=big-g"`. In a world it waits for 8 frames. |
| `click <target>` | Click a control. |
| `press <key> [target]` | Press a key (`KeyN`, `Enter`, `End`), on a control or on the page. |
| `hold <keys> <ms>` | Hold keys together, such as `hold Shift+KeyW 3000` to run. |
| `select <value> <target>` | Choose an option, such as `select low --label "Rendering quality"`. |
| `swipe <x0> <y0> <x1> <y1> [holdMs]` | Drag a finger (phone instances). |
| `frames <n>` | Wait for n more frames. |
| `text <target>` | Print the text of every visible match. |
| `probe` | Print the visible state without acting. |
| `pause on` / `pause off` | Freeze or release time, to compare two views of one moment. It is the probe's only setter, not a user action. |
| `gpu lose` / `gpu restore` | Lose or restore the view's WebGL context, as a graphics card reset does. Like `pause`, it changes the page's surroundings, not a user action. |
| `sample` | Mean and spread of the view's brightness. Needs `e2e` in the URL, which keeps the drawing buffer. |
| `shot <name>` / `aria <name>` | Save a screenshot or an ARIA snapshot into the evidence folder. |
| `errors` | Console errors and warnings recorded since launch. |

A target is `--role <role> --name <exact name>`, `--label <exact label>`, or a Playwright selector. Prefer roles and the app's data attributes: `.plate[data-world=…]`, sliders `[data-dial=c|hbar|G]`, switches `[data-toggle=…]`, buttons `[data-action=…]`, `[data-reset=real|preset]`, `[data-share]`, `[data-tour-next]`, `.choice[data-choice=N]`, `.proof[data-proof=…]`.

Software WebGL is slow. A world draws a few frames a second at low quality, and Big G well under one. Choose Low on the title screen (`select low --label "Rendering quality"`) before entering a world, and wait with `frames`, never with sleeps.

## Evidence

- Prove the user path: plates, buttons, keys, sliders and swipes, not the probe. Deep links (`?world=…&c=…`) are a real path too, because Share produces them.
- Capture the action and the result: the JSON printed before and after, plus `shot` and `aria` of the result. Name files `<feature-id>-<step>`.
- Check side effects, not only the screen: a dial change shows in `constants` and in the dial's value text, Share puts the dial values in the URL, and the quality choice survives a reload.
- `ctl errors` must show 0 errors at the end of every journey.
- Report each feature-map entry as PASS, ISSUES (what differed, with evidence) or BLOCKED (the unmet precondition). Never report an entry as verified through a different path than the one it names.

## Cleanup

`ctl cleanup` stops the server and browser this instance started (by process group, never by name) and deletes the profile and state. It keeps `evidence/` and the logs. Run it after every run, failed ones too, with the same `VERIFY_PORT`.

## Feature map

[`features/README.md`](features/README.md) indexes one file per feature. Change the map in the same commit as the feature.
