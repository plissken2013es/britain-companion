# Contributing

Thanks for helping. Spanish or English, as you prefer.

## Reporting a bug

Open an [issue](https://github.com/plissken2013es/britain-companion/issues/new/choose). The most useful thing is the **game code**: in a game, ☰ → *Copy the
game code* (it starts with `UBB1.`). With it we can replay your game up to the moment it went wrong. Say also what
happened, what you expected, and your browser or phone.

## Pull requests

- Plain JavaScript modules, no build and no dependencies. Run `npm test` before sending.
- The rules engine (`src/engine/`) has no DOM, no timers and no `Math.random`; a change to a rule needs a test.
- Every text on screen goes through `t()`, in Spanish and English (`src/i18n/`). New texts may stay in English in
  the other languages (`src/i18n/lang/`): they show in English until a translator fills them in.
- Translations: see [Translating the companion](README.md#translating-the-companion).
- Nothing of the game itself: no photos or scans of its tiles, cards or counters, and no texts of its rulebook or
  scenario book.
- Some fields look unused here but are needed by the project this one is built from (it has a full digital version
  used to study the rules): please do not remove data fields or exports without asking in the pull request.

This repository is built from the source of that larger private project. A pull request accepted here is applied
there with its author and comes back in the next release, so it may be merged by hand rather than with the merge
button.
