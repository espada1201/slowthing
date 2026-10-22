# Graphics card reset

When the graphics card resets, the browser takes the 3D view's WebGL context away and the view goes black. A message in the middle of the screen says so while the browser restores it, clears once the view is back, and after 5 s without a restore tells the visitor to reload the page.

## Sub-features

- `gpu-lost` while the context is lost, the status message reads `The graphics card was reset. Restoring the view…` and the view is blank.
- `gpu-restored` once the context is restored, the message clears and the world draws again.
- `gpu-reload` after 5 s without a restore, the message reads `The graphics card was reset and the view did not come back. Reload the page to bring the world back.`

## How to get to it (user POV)

- Nothing the visitor does on purpose: a driver crash, a GPU process restart or too many tabs drawing at once. `ctl gpu` stands in for one.

## Driving it with ctl

Preconditions:

- A desktop instance is in World I, opened with `ctl go "?world=slow-light&quality=low&e2e"`.

- **Lose.** Run `ctl gpu lose`, then at once `ctl aria gpu-lost` and `ctl shot gpu-lost`. `gpuReset` reads `The graphics card was reset. Restoring the view…`, and the snapshot has it as a `status`, which screen readers announce. `ctl sample` prints mean 0 and spread 0.
- **Restore.** Run `ctl gpu restore`, `ctl frames 10` and `ctl sample`. `gpuReset` is null and the spread is above 8 again.
- **No restore.** Run `ctl gpu lose`, then `ctl frames 400` (with nothing to draw, frames come about 60 a second). `gpuReset` reads `The graphics card was reset and the view did not come back. Reload the page to bring the world back.` Take `ctl shot gpu-reload`.
- **Proof.** Run `ctl gpu restore` and `ctl errors`.

## Gotchas

- A lost context hands out no extensions, so `gpu restore` uses the one that `gpu lose` kept in the same page. After a `go`, lose before you restore.
- Frames keep counting while the context is lost, though nothing is drawn; judge recovery by `sample`, not by `frames`.
- The message turns into the reload advice 5 s after the loss, and every `ctl` call takes a second or two, so capture the first message straight after `gpu lose`.
