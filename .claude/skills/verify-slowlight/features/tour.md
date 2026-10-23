# Guided tour

Each world opens on a tour card: a numbered stop with a title and one or two sentences. A stop can move the visitor, set dials and switches, and start an action. Some stops first ask a prediction question; the text and the instruments stay hidden until the visitor answers or chooses `Just show me`. A measurement stop instead asks for typed numbers and keeps up only the instruments it needs.

## Sub-features

- `tour-next` `Next →`, `←` and the N and B keys move between stops; the ends disable their buttons.
- `tour-apply` a stop applies its pose, dials, switches and action.
- `tour-predict` a prediction hides the stop's text and the instruments until answered.
- `tour-answer` answering marks the right choice and a wrong pick, for screen readers too, then shows the reveal and the text.
- `tour-skip` `Just show me` reveals without marking a pick.
- `tour-optional` a question or measurement says `Optional: Next goes on without an answer.` until it is answered.
- `tour-end` the last stop says the tour is over, below its text (below the answer, at a stop that asks a question); from the keyboard, focus stays in the card: a button that greys out under the keyboard hands focus on (`←` at the first stop to `Next`; `Next` at the last to the first answer of a question still open, else to the closing line).
- `tour-measure` a measurement stop takes typed answers, refuses anything that is not a number, and says how far off each was; driven in big-g.md (`Weigh the hole`).

## How to get to it (user POV)

- Enter any world; the card sits at the bottom of the view.
- Press N or B anywhere outside a text field.

## Driving it with ctl

Preconditions:

- A desktop instance is in World I (see slow-light.md, step Enter).

- **First stop.** Run `ctl probe`. `tour.stop` is `1 / 12` and the `Previous tour stop` button is disabled (`ctl aria tour-first`).
- **Next by button.** Run `ctl click --role button --name "Next tour stop"`. `tour.stop` is `2 / 12`, `tour.title` is `The late clock`, and `tour.predicting` is true.
- **Hidden text.** Run `ctl text '.tour-text'` and `ctl text '.readouts'`. Both print `[]`: the stop's text and the instruments wait for an answer.
- **Answer wrong.** Run `ctl click '.choice[data-choice="2"]'`, then `ctl text '.predict-reveal'`. The reveal starts `Not quite.` and mentions `5.4 s`. `ctl text '.choice[data-state="right"]'` prints `about 5 s behind` and `ctl text '.choice[data-state="wrong"]'` prints `about 5 s ahead`. Take `ctl shot tour-answered` and `ctl aria tour-answered`: the buttons are named `about 5 s behind (right answer)` and `about 5 s ahead (your answer, wrong)`, all disabled.
- **Next by key.** Run `ctl press KeyN`. `tour.title` is `Aberration` and the cruise starts.
- **Skip.** Run `ctl click --role button --name "Just show me"`. The reveal shows without `Right.` or `Not quite.`.
- **Back by key.** Run `ctl press KeyB`. `tour.stop` is `2 / 12`.
- **Optional.** At stop 2, `ctl text '.predict-opt'` prints `Optional: Next goes on without an answer.`; after an answer it prints `[]`.
- **Last stop.** Press N until `tour.stop` is `12 / 12`. `Next tour stop` is disabled and `constants.c` is 299792458. `ctl text '.tour-end'` prints `That is the end of the tour.` and the rest of its line; at stop 11 it prints `[]`.
- **Proof.** Run `ctl shot tour-final` and `ctl errors`.

## Gotchas

- From the keyboard alone, Tab reaches Next, Enter or Space steps on, focus lands on a question's first answer, and Tab from an answer returns to Next; `e2e/keyboard-tour.spec.ts` walks all three tours that way.
- N and B are ignored while a text field or a select has focus, and Space or Enter on a focused button presses that button.
- Arriving at a stop runs its action (a cruise, a roll, the tram), so readouts change on their own right after a step. Under reduced motion it waits for `Start` instead (reduced-motion.md).
- Stops are meant to be one or two sentences. A longer stop is an ISSUE.
