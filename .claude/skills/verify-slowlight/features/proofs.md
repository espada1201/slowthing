# Proofs page

`Check the physics →` opens a page that runs every physics check in the visitor's own browser. CPU checks hold the physics engine to textbook results; GPU checks run the worlds' own shaders and hold them to that physics. Each row shows its claim, pass or fail, and the measured against the expected value.

## Sub-features

- `proofs-run` every proof runs on arrival and the summary reads `N of N passed`.
- `proofs-gpu` the GPU proofs (`gpu-aberration`, `gpu-doppler`, `gpu-retarded`, `gpu-tram-colour`, `gpu-schrodinger`, `gpu-geodesics`) pass.
- `proofs-again` `Run again` reruns every check.
- `proofs-back` `← Worlds` returns to the title screen.

## How to get to it (user POV)

- Choose `Check the physics →` on the title screen.
- Open `?proofs`.

## Driving it with ctl

Preconditions:

- A desktop instance is on the title screen.

- **Open.** Run `ctl click '[data-proofs]'`. The URL is `/?proofs` and the summary starts `Running…` or counts up.
- **Finish.** Run `ctl probe` every few seconds until `proofs` reads `N of N passed` (two minutes at most on SwiftShader). Then `ctl text '.proof[data-state="fail"]'` prints an empty list.
- **Measured values.** Run `ctl text '.proof-result'`. Every row reads `Measured … Expected …`.
- **Run again.** Run `ctl click --role button --name "Run again"` and wait for `N of N passed` again.
- **Back.** Run `ctl click --role button --name "← Worlds"`. Mode is `title`.
- **Proof.** Before going back, run `ctl shot proofs-passed`, `ctl aria proofs-passed` and `ctl errors`.

## Gotchas

- The GPU proofs compile the worlds' shaders, so the first run takes the longest.
- A proof that throws shows `error` in place of `fail`; both count against N.
- `Run again` is disabled while a run is in progress.
