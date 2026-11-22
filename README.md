# Britain Companion

An unofficial companion for playing **Undaunted: Battle of Britain** solo against the computer, **with your own copy
of the game**. The app plays the other side; you play yours with your cards, tiles, counters, markers and dice.

- The app never draws for you: it only knows which cards you may hold, and tells you when to draw, shuffle, discard,
  take a Discord or take a card out after a hit. It checks that what you play is a card you can have.
- You say which card you play and how, and fly your aircraft step by step; for each attack it works out the number
  you need and asks whether you hit. Its own dice roll on screen (or you roll them on the table).
- After each of your answers it tells you, step by step, what the computer does on the table ("move the BF 109E:
  forward, forward, turn to face south"), with a map of its own: sea and land hex by hex, the letters of the land
  tiles, clouds, balloons, ships, structures and anti-aircraft guns.
- The 11 scenarios of the scenario book; set them up with your book. With decoys (scenario 9), the app knows in
  secret which counter is the aircraft. Spanish and English, and more languages are welcome: see
  [Translating the companion](#translating-the-companion).

**Beta (0.1.0-beta).** Play it at https://plissken2013es.github.io/britain-companion/, and tell us what goes wrong: open an
[issue](https://github.com/plissken2013es/britain-companion/issues) (with the game code from ☰ → Copy the game code, if you can) or use *Report a bug* in
the app.

## Play locally

Open `index.html` through a local server, for example:

    node serve.mjs

and go to http://localhost:8062/. No build and no dependencies: plain JavaScript modules.

## Translating the companion

The companion speaks Spanish and English, and new languages are very welcome. Please open your pull request on this
repository: it is applied to the project it is built from, with you as its author, and comes back in the next release
(see [CONTRIBUTING.md](CONTRIBUTING.md)). If you would rather work with a spreadsheet than with code, open an issue
and ask for the translation sheet.

1. **Start your file** (using Italian, `it`, as the example):

       node src/i18n/new-language.mjs it Italiano

   It writes `src/i18n/lang/it.js` with every English text in place and lists it in `src/i18n/lang/index.js`. There is
   nothing else to touch: the language menu and the credits come from that file.
2. **Translate the strings.** Keep the keys, the `{placeholders}` (in English: `{side}` stays `{side}`) and the code
   of the small functions (they write "1 die" or "2 dice"): change only the words.

   ```js
   'cmp.round': 'Round {n}',                       // → 'Turno {n}',
   ```
3. **Use the words printed in the game in your language.** The player reads the app with the cards in hand, so game
   terms such as Discord, Bolster, Inspire, Guide, Coordinate, section, initiative or suppressed must be exactly
   those of the official edition of *Undaunted: Battle of Britain* in your language, not new translations of the
   English ones. Translate the scenario titles only if that edition does. Aircraft names stay as they are. If there
   is no edition in your language, say so in the pull request and choose the words a player would expect.
4. **Only the companion's own texts.** Nothing from the rulebook or the scenario book (the app writes the objectives
   itself from the victory conditions).
5. **Credit yourself** in `credit` (for example `'Traduzione italiana: your name'`): it shows in the credits of the
   start screen.

Before opening the pull request:

    node src/i18n/new-language.mjs --check it   # what is still in English, or broken
    npm test                                    # all tests must pass
    node serve.mjs                              # then http://localhost:8062/?lang=it: start a game, play a few turns

Texts added in later versions arrive in English first: `--check` lists them, and a short pull request filling them in is
just as welcome.

## Credits

Undaunted: Battle of Britain is a game by David Thompson and Trevor Benjamin, published by Osprey Games. This
companion is not official and not endorsed by them. It includes none of the game's art, rulebook or scenario texts:
you need the game.

- Aircraft: our own pixel art, made with PixelLab for this companion; terrain drawn by its own code
  (`assets/companion/`).
- 3D dice: three.js and cannon-es (MIT, `vendor/`).
- Sounds (`assets/sounds/`, the licence beside each folder): gunfire from The Free Firearm Sound Library (CC0);
  cards from Kenney's Casino Audio (CC0); Spitfire engines by JW_Audio, itinerantmonk108, beerbelly38 and squashy555
  (Freesound, CC0); Bf 109 engines: "Bf-109 Flyby", "Spitfires and Bf-109 Flyby" and "Bf-109 - Daimler-Benz Run-Up" by
  Fight2FlyPhoto (Freesound, [CC BY 3.0](http://creativecommons.org/licenses/by/3.0/)), and a DB 605 recording by a
  Freesound user (CC0).

## Tests

    npm test

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The code is under the [MIT license](LICENSE). It covers this code only: Undaunted: Battle of Britain, its rules, art
and texts belong to their owners. The 3D dice libraries and the sounds keep their own licences (`vendor/`,
`assets/sounds/`).
