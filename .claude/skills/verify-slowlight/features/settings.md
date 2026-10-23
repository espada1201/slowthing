# Sound and help

Inside a world the top bar holds `Sound` (Doppler-shifted bells, detector clicks, distant clocks), a quality choice and `?`, which opens the controls help.

## Sub-features

- `set-sound` `Sound` toggles and reports its state as pressed or not.
- `set-help` `?` opens and closes a dialog listing the keys, including the world's own actions.
- `set-quality` the in-world quality choice changes the resolution at once and is remembered.
- `set-auto` on `Auto` the choice names the preset it is running; on SwiftShader it settles on `Auto (low)`. A preset chosen by hand stays, with only its resolution trimmed.

## How to get to it (user POV)

- The top bar of any world.
- Esc closes the help.

## Driving it with ctl

Preconditions:

- A desktop instance is in any world.

- **Sound on.** Run `ctl click '[data-sound]'` and `ctl aria set-sound`. The `Sound` button is pressed. Click again: not pressed.
- **Help.** Run `ctl click --role button --name "Controls help"` and `ctl text '.help'`. The dialog lists `W A S D`, `Shift`, the world's action keys, and `N` and `B`. Run `ctl press Escape`; the dialog is hidden.
- **Auto.** Run `ctl select auto '.topbar select'`, then `ctl go "?world=slow-light"` (no quality in the URL) and `ctl aria set-auto-start`: the `Rendering quality` combobox shows `Auto (medium)` selected. After `ctl frames 30` twice, `ctl aria set-auto` shows `Auto (low)`.
- **Quality.** Run `ctl select high '.topbar select'`; the first option reads plain `Auto` again. Then `ctl go /` and `ctl aria set-quality`. The title screen shows `High` selected.
- **Proof.** Run `ctl shot set-help` while the help is open, then `ctl errors`.

## Gotchas

- Sound left on starts at the first click, touchend or key press, and comes back at the next one after Safari interrupts the audio (a call, another app); `tests/audio.test.ts` drives that with a fake context.
- Headless Chromium plays no audio, so `set-sound` proves the control and its state, not the sound itself.
- There are two quality selects in a world (top bar and panel); they stay in step, so choose either.
