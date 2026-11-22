// Game state and the basic operations on it (docs/01 §3–§9). Pure: no DOM, no timers, no Math.random.

import { log, note, choose, GameEnd } from './ask.js';
import { SIDES, TYPES, typeOf, nameToType, unitToType, scenarioById, counterOf, baseId, markerDefence } from './data.js';
import { boardFrom, key, distance, DIRS } from './hex.js';
import { seedFrom, shuffle, nextRandom } from './rng.js';

const ZONES = ['deck', 'hand', 'discard', 'play', 'supply'];

/** The setup of a game someone is playing: no round limit, which is only a safety net for bots ([D-12]). */
export const withoutRoundLimit = (setup) => ({ ...setup, maxRounds: 9999 });

export function normalizeSetup(setup = {}) {
    const out = {
        scenario: Number(setup.scenario ?? 1),
        seed: String(setup.seed ?? 'ubb'),
        maxRounds: setup.maxRounds ?? 100,
        ...(setup.players ? { players: setup.players } : {}),
    };
    // the companion (docs/02 §8.4): one seat plays with a physical deck and dice; botDice 'physical' = the player
    // also rolls the bot's dice. Only there when asked for, so old codes keep the same setup
    if (setup.external === 0 || setup.external === 1) {
        out.external = setup.external;
        out.botDice = setup.botDice === 'physical' ? 'physical' : 'virtual';
    }
    return out;
}

const boards = new Map();
/** Board hexes of the game's scenario (cached; the state only keeps the scenario id). */
export function boardOf(g) {
    if (!boards.has(g.scenario)) boards.set(g.scenario, boardFrom(scenarioById(g.scenario).hexes));
    return boards.get(g.scenario);
}

export function createState(setup) {
    const s = scenarioById(setup.scenario);
    const g = {
        setup,
        scenario: s.id,
        rng: seedFrom(setup.seed),
        round: 0,
        turn: null,
        phase: 'setup',
        initiative: SIDES.indexOf(s.initiative),
        players: SIDES.map((side) => ({ side, deck: [], hand: [], discard: [], play: [], supply: [], removed: [], aside: [], bid: null })),
        aircraft: {},
        markers: [],
        deploy: [],
        log: [],
        notes: [[], []],
        result: null,
        pending: null,
    };
    // cards: one instance per D / S letter (docs/01 §3)
    SIDES.forEach((side, seat) => {
        const counts = {};
        for (const [name, spec] of Object.entries(s.cards[side] ?? {})) {
            const type = nameToType(side, name);
            for (const ch of spec) {
                counts[type] = (counts[type] ?? 0) + 1;
                const cid = `${side}:${type}:${counts[type]}`;
                g.players[seat][ch === 'D' ? 'deck' : 'supply'].push(cid);
            }
        }
        shuffle(g, g.players[seat].deck);
    });
    for (const tok of s.tokens) {
        const hex = key(...tok.hex);
        if (tok.type === 'deploy') {
            g.deploy.push(hex);
        } else if (tok.type === 'aircraft') {
            const seat = SIDES.indexOf(tok.side);
            const id = `${tok.side}:${unitToType(tok.unit)}`;
            g.aircraft[id] = { id, seat, hex, facing: DIRS.indexOf(tok.facing), ready: tok.state !== 'out', status: 'board', ...(tok.decoy ? { decoy: true } : {}) };
        } else {
            const m = { id: `m${g.markers.length + 1}`, type: tok.type, hex, status: 'board' };
            if (tok.facing) m.facing = DIRS.indexOf(tok.facing);
            if (tok.face) m.face = tok.face;
            const defence = tok.defence ?? markerDefence(tok.type);
            if (defence != null) m.defence = defence;
            g.markers.push(m);
        }
    }
    // scenario 9: aircraft with cards but no counter on the map are set up by their player on the deploy hexes
    if (g.deploy.length) {
        SIDES.forEach((side, seat) => {
            for (const name of Object.keys(s.cards[side] ?? {})) {
                const id = `${side}:${nameToType(side, name)}`;
                if (TYPES[id].kind === 'combat' && !g.aircraft[id]) g.aircraft[id] = { id, seat, hex: null, facing: 0, ready: true, status: 'deploy' };
            }
        });
    }
    // scenario 9 decoys ([D-14]): one more counter per listed aircraft. The opponent only ever sees public aliases
    // ("luftwaffe:G1@1" / "@2", in random order), so it cannot tell the decoy from the aircraft.
    if (s.decoys) {
        g.alias = {};
        const side = SIDES[1];
        for (const unit of s.decoys) {
            const id = `${side}:${unitToType(unit)}`;
            const real = g.aircraft[id];
            g.aircraft[`${id}~`] = { id: `${id}~`, seat: real.seat, hex: null, facing: 0, ready: true, status: real.status, decoy: true, of: id };
            const pair = nextRandom(g) < 0.5 ? [id, `${id}~`] : [`${id}~`, id];
            pair.forEach((k, i) => (g.alias[k] = `${id}@${i + 1}`));
        }
    }
    return g;
}

/** Public id of a counter (its alias when it has a decoy twin). */
export const pub = (g, id) => g.alias?.[id] ?? id;

/** Counter id from a public id. */
export const unpub = (g, pid) => (g.alias ? Object.keys(g.alias).find((k) => g.alias[k] === pid) ?? pid : pid);

/** The decoy of an aircraft, if it is still on the board. */
export function decoyOf(g, a) {
    const d = g.aircraft[`${a.id}~`];
    return d?.status === 'board' ? d : null;
}

/** [D-14] A decoy leaves the board: revealed by a successful attack, or because its aircraft acted or was hit. */
export function removeDecoy(g, d, why) {
    d.status = 'removed';
    log(g, 'decoyRemoved', { seat: d.seat, aircraft: d.id, why });
}

// ------------------------------------------------------------------ cards

// ------------------------------------------------------------------ external seat (docs/02 §8.4)
// A seat whose deck and hand are physical: the engine knows which cards are in them together (everything else is
// public) and how many are in each, but not which are in the hand. Its p.hand and p.deck hold those cards split in
// some order; when the player says which card they hold, `bring` swaps one of that type into the hand. So the engine
// checks what can be checked: a card played, bid, discarded or lost from the hand must be among the cards the player
// may hold.

export const isExternal = (g, seat) => g.setup.external === seat;

/** Cards that may be in `seat`'s hand: the hand, or for an external seat the hand and the deck (none if the hand is empty). */
export function handPool(g, seat) {
    const p = g.players[seat];
    if (!p.hand.length) return [];
    return isExternal(g, seat) ? [...p.hand, ...p.deck] : p.hand;
}

/**
 * The first card of `seat`'s `where` ('hand' or 'deck') that fits `pred`; for an external seat one from the other
 * pile is swapped in if needed (the engine's split of the two is a guess). Null if there is none.
 */
export function bring(g, seat, pred, where = 'hand') {
    const p = g.players[seat];
    const here = p[where];
    const i = here.findIndex(pred);
    if (i >= 0) return here[i];
    if (!isExternal(g, seat) || !here.length) return null;
    const there = p[where === 'hand' ? 'deck' : 'hand'];
    const j = there.findIndex(pred);
    if (j < 0) return null;
    const k = here.length - 1;
    [here[k], there[j]] = [there[j], here[k]];
    return here[k];
}

/** The aircraft a combat card flies ("raf:Y1:2" → aircraft "raf:Y1"). */
export const aircraftOfCard = (cid) => cid.slice(0, cid.lastIndexOf(':'));

/** Draw up to n cards into the hand, reshuffling the discard pile (never the play area). Returns the cards drawn. */
export function drawCards(g, seat, n) {
    const p = g.players[seat];
    const drawn = [];
    let first = null; // cards drawn before the deck ran out and the discard pile was shuffled
    for (let i = 0; i < n; i++) {
        if (!p.deck.length) {
            if (!p.discard.length) break; // [D-9]
            first ??= drawn.length;
            p.deck = shuffle(g, p.discard);
            p.discard = [];
            log(g, 'reshuffle', { seat });
        }
        drawn.push(p.deck.pop());
    }
    p.hand.push(...drawn);
    // an external seat draws from its physical deck: the engine's cards are only a guess, so no note of them
    if (drawn.length && !isExternal(g, seat)) note(g, seat, 'drew', { cards: drawn });
    // the physical ones are unknown: the companion tells the player how many to draw, and when to shuffle
    if (isExternal(g, seat)) log(g, 'draw', { seat, n: drawn.length, want: n, first });
    return drawn;
}

/** Move a card between zones of one player. */
export function moveCard(g, seat, cid, from, to) {
    const p = g.players[seat];
    const i = p[from].indexOf(cid);
    if (i < 0) throw new Error(`${cid} is not in ${from}`);
    p[from].splice(i, 1);
    p[to].push(cid);
}

/** Take a Discord card from the supply into the discard pile (no effect if none left). */
export function gainDiscord(g, seat, why) {
    const p = g.players[seat];
    const i = p.supply.findIndex((c) => typeOf(c).kind === 'discord');
    if (i < 0) {
        log(g, 'discordNone', { seat, why });
        return;
    }
    p.discard.push(...p.supply.splice(i, 1));
    log(g, 'discord', { seat, why });
}

// ------------------------------------------------------------------ aircraft

export const counter = (a) => counterOf(a.id);
export const sectionOf = (a) => TYPES[baseId(a.id)].section;
export const onBoard = (g) => Object.values(g.aircraft).filter((a) => a.status === 'board');

/** docs/01 §9 and [D-6]: both aircraft of the section on the board and at most one hex apart. */
export function outOfComms(g, seat, section) {
    if (!section) return false;
    const all = Object.values(g.aircraft).filter((a) => a.seat === seat && sectionOf(a) === section);
    // scenario 9: while one of the section's decoys is on the board, the section is in comms
    if (all.some((a) => a.decoy && a.status === 'board')) return false;
    const mates = all.filter((a) => !a.decoy);
    const live = mates.filter((a) => a.status === 'board');
    if (live.length < 2 || live.length < mates.length) return true;
    return distance(live[0].hex, live[1].hex) > 1;
}

/**
 * Remove every card of an aircraft from all zones (to `removed`); returns how many left each zone, which the log
 * shows (anyone at the table sees them go). An external seat's hand and deck are one pile to the engine (`hidden`),
 * so it cannot know how many of them were in the hand: settlePurge asks.
 */
function purgeCards(g, a, zones) {
    const p = g.players[a.seat];
    const mine = (c) => aircraftOfCard(c) === a.id;
    const out = {};
    const k = isExternal(g, a.seat) ? [...p.hand, ...p.deck].filter(mine).length : 0;
    const [H0, D0] = [p.hand.length, p.deck.length];
    for (const z of zones) {
        const keep = [];
        for (const c of p[z]) (mine(c) ? p.removed : keep).push(c);
        const n = p[z].length - keep.length;
        if (n && !(k && (z === 'hand' || z === 'deck'))) out[z] = n;
        p[z] = keep;
    }
    if (k) {
        // until the player says, the cards came from the deck as far as it had them (the companion counts the same)
        out.hidden = k;
        const n0 = Math.max(0, k - D0);
        while (p.hand.length < H0 - n0) p.hand.push(p.deck.pop());
        while (p.hand.length > H0 - n0) p.deck.push(p.hand.pop());
        g.purge = { seat: a.seat, aircraft: a.id, k, H0, D0, n0 };
    }
    return out;
}

/** docs/01 §6 and §8: the counter leaves the board and its cards leave the game ([D-5]: also from the play area). */
export function neutralise(g, a, why) {
    if (a.decoy) return removeDecoy(g, a, why);
    a.status = 'neutralised';
    const cards = purgeCards(g, a, ZONES);
    log(g, 'neutralised', { seat: a.seat, aircraft: a.id, why, cards });
    checkWin(g);
}

/**
 * After an external seat's aircraft left the board with cards in hand or deck: how many of them were in its hand
 * (`purge`), so the engine's hand keeps the size of the player's. Called by every generator that may neutralise or
 * let out an aircraft; the cards themselves are gone already.
 */
export function* settlePurge(g) {
    const q = g.purge;
    if (!q) return;
    g.purge = null;
    const opts = [];
    for (let n = Math.max(0, q.k - q.D0); n <= Math.min(q.k, q.H0); n++) opts.push({ id: `hand:${n}`, n });
    const answer = yield* choose(g, q.seat, 'purge', opts, { aircraft: q.aircraft, cards: q.k });
    const n = Number(answer.slice(5));
    const p = g.players[q.seat];
    // `moved`: cards that go back from the engine's hand to its deck, now that the hand has lost n, not n0
    for (let d = n - q.n0; d > 0; d--) p.deck.push(p.hand.pop());
    log(g, 'purged', { seat: q.seat, aircraft: q.aircraft, hand: n, moved: n - q.n0 });
}

export function escapeAircraft(g, a) {
    a.status = 'escaped';
    const cards = purgeCards(g, a, ZONES);
    log(g, 'escaped', { seat: a.seat, aircraft: a.id, cards });
    checkWin(g);
}

/**
 * docs/01 §8.4: one hit removes a card of the aircraft from hand, else discard, else deck; otherwise neutralised.
 * `from`: where an external seat says the card came from (one of casualtyFrom's).
 */
export function hit(g, a, from = null) {
    if (a.decoy) return removeDecoy(g, a, 'revealed');
    const twin = decoyOf(g, a);
    if (twin) removeDecoy(g, twin, 'paired');
    const p = g.players[a.seat];
    const mine = (x) => aircraftOfCard(x) === a.id;
    if (from === 'hand' || from === 'deck') bring(g, a.seat, mine, from);
    for (const z of from ? [from] : ['hand', 'discard', 'deck']) {
        const c = p[z].find(mine);
        if (c) {
            moveCard(g, a.seat, c, z, 'removed');
            if (z === 'deck') shuffle(g, p.deck);
            log(g, 'hit', { seat: a.seat, aircraft: a.id, from: z });
            return;
        }
    }
    neutralise(g, a, 'hit');
}

/**
 * Where an external seat may take a hit's card from, in the rules' order: the hand or, when the hand has none, the
 * discard pile or else the deck (never the deck with one in the discard pile). [] = none left: it is neutralised.
 */
export function casualtyFrom(g, a) {
    const p = g.players[a.seat];
    const mine = (c) => aircraftOfCard(c) === a.id;
    const hidden = [...p.hand, ...p.deck].some(mine);
    const out = [];
    if (hidden && p.hand.length) out.push('hand');
    if (p.discard.some(mine)) out.push('discard');
    else if (hidden && p.deck.length) out.push('deck');
    return out;
}

// ------------------------------------------------------------------ end of game

/** Has `seat` met one of its scenario objectives? (docs/01 §10; "win" in the scenario JSON) */
export function objectiveMet(g, seat) {
    return (scenarioById(g.scenario).win?.[SIDES[seat]] ?? []).some((c) => condMet(g, seat, c));
}

/** One condition of docs/02 §2.3 ("all" = every sub-condition, e.g. scenario 8's "neutralise two, then escape two"). */
function condMet(g, seat, c) {
    if (c.all) return c.all.every((x) => condMet(g, seat, x));
    if (c.neutralise != null) return neutralisedValue(g, seat, c) >= c.neutralise;
    if (c.destroy != null) return g.markers.filter((m) => m.status === 'destroyed' && (!c.what || c.what.includes(m.type))).length >= c.destroy;
    if (c.escape != null) {
        const ships = c.what === 'ship' ? g.markers.filter((m) => m.type === 'ship' && m.status === 'escaped').length : 0;
        const planes = c.what !== 'ship' ? Object.values(g.aircraft).filter((a) => a.seat === seat && a.status === 'escaped' && matches(a, c)).length : 0;
        return ships + planes >= c.escape;
    }
    if (c.points != null) return pointsOf(g, seat, c) >= c.points;
    return false;
}

/**
 * [D-13] (designer, BGG 3111077): in an "all" objective such as scenario 8's "neutralise two, then escape", the
 * escape is only allowed once the other parts are met.
 */
export function escapeOpen(g, seat) {
    const conds = scenarioById(g.scenario).win?.[SIDES[seat]] ?? [];
    return conds.every((c) => !c.all || c.all.every((x) => x.escape != null || condMet(g, seat, x)));
}

/** Enemy aircraft neutralised; `ace` weights aces (scenario 10: an ace counts as two). */
function neutralisedValue(g, seat, c) {
    return enemyValue(g, seat, c, (a) => a.status === 'neutralised');
}

function enemyValue(g, seat, c, which) {
    return Object.values(g.aircraft)
        .filter((a) => a.seat !== seat && !a.decoy && which(a) && matches(a, c))
        .reduce((n, a) => n + weightOf(c, a.id), 0);
}

/** What one enemy aircraft counts for a neutralise condition: `ace` for an ace (scenario 10), else its `weights`. */
export const weightOf = (c, id) => (c.ace && TYPES[baseId(id)].rank === 'ace' ? c.ace : c.weights?.[TYPES[baseId(id)].aircraft] ?? 1);

/**
 * Points objective (scenarios 3, 9 and 11): `per` gives the points of each neutralised enemy aircraft, each destroyed
 * marker type and, in `escaped`, each own aircraft type that escapes.
 */
export function pointsOf(g, seat, c) {
    const per = c.per ?? {};
    let n = (per.aircraft ?? 0) * neutralisedValue(g, seat, {});
    for (const m of g.markers) if (m.status === 'destroyed') n += per[m.type] ?? 0;
    for (const a of Object.values(g.aircraft)) if (a.seat === seat && a.status === 'escaped') n += per.escaped?.[TYPES[a.id].aircraft] ?? 0;
    return n;
}

/**
 * Filter of a condition: units (["H1", "B*"]), aircraft types (["Heinkel"]) or rank ("ace" / "other"). Takes any id
 * (a decoy's, or the public alias of scenario 9), so the bots can call it on their view.
 */
export function matches(a, c) {
    const id = baseId(a.id);
    if (c.units && !c.units.map((u) => `${SIDES[a.seat]}:${unitToType(u)}`).includes(id)) return false;
    if (c.aircraft && !c.aircraft.includes(TYPES[id].aircraft)) return false;
    if (c.rank && (TYPES[id].rank === 'ace') !== (c.rank === 'ace')) return false;
    return true;
}

/** Does the scenario let this aircraft out through its escape hexes? (`escapers`, docs/02 §2.3) */
export function mayEscape(g, a) {
    const allowed = scenarioById(g.scenario).escapers?.[SIDES[a.seat]];
    return allowed === 'all' || (Array.isArray(allowed) && allowed.includes(TYPES[baseId(a.id)].aircraft));
}

/**
 * Ends the game if a side has won, or in a draw when neither side can win any more ([D-12], [D-20]). Called after
 * anything that can change an objective and after every card played.
 */
export function checkWin(g) {
    const won = [0, 1].filter((s) => objectiveMet(g, s));
    // both at once (one bomb ends both?) cannot happen with the printed objectives; the acting side would win
    if (won.length) endGame(g, won.length === 1 ? won[0] : g.turn, 'objective');
    if (!canWin(g, 0) && !canWin(g, 1)) endGame(g, null, 'draw');
}

// ------------------------------------------------------------------ draw

/**
 * [D-20] Can `seat` still meet one of its objectives? An upper bound by counting pieces and cards, with no geometry:
 * every enemy aircraft still in play could be neutralised, every marker bombed, every own aircraft escape, as long
 * as the means are left (a card with Attack or Bomb outside `removed`, a barrage balloon, a Sail card). Never false
 * while a win is possible; it may stay true in positions that are lost in practice.
 */
export function canWin(g, seat) {
    return (scenarioById(g.scenario).win?.[SIDES[seat]] ?? []).some((c) => reachable(g, seat, c));
}

const live = (a) => (a.status === 'board' || a.status === 'deploy') && !a.decoy;
/** Markers a bomber can destroy (docs/01 §8). */
export const BOMBABLE = ['ship', 'structure', 'aaa'];

/** A RAF aircraft on the ground (scenarios 7, 9 and 11): it cannot be attacked, only bombed, and its card readies it. */
export const grounded = (a) => a.seat === 0 && !a.ready;

/** Some card of `seat` outside `removed` has `action`; for combat actions, only cards of aircraft still in play. */
function hasAction(g, seat, action) {
    return ZONES.some((z) =>
        g.players[seat][z].some((c) => {
            const t = typeOf(c);
            if (!t.actions.some((x) => x.type === action)) return false;
            return t.kind !== 'combat' || live(g.aircraft[aircraftOfCard(c)]);
        }));
}

/** Enemy aircraft can still fall: own Attack or Bomb (grounded RAF aircraft), or a barrage balloon they fly into. */
const canKill = (g, seat) =>
    hasAction(g, seat, 'attack') || hasAction(g, seat, 'bomb') || g.markers.some((m) => m.type === 'balloon' && m.status === 'board');

function reachable(g, seat, c) {
    if (c.all) return c.all.every((x) => reachable(g, seat, x));
    if (condMet(g, seat, c)) return true;
    if (c.neutralise != null) return canKill(g, seat) && neutralisedValue(g, seat, c) + enemyValue(g, seat, c, live) >= c.neutralise;
    if (c.destroy != null) {
        const types = c.what ?? BOMBABLE;
        const done = g.markers.filter((m) => m.status === 'destroyed' && types.includes(m.type)).length;
        const left = g.markers.filter((m) => m.status === 'board' && types.includes(m.type)).length;
        return hasAction(g, seat, 'bomb') && done + left >= c.destroy;
    }
    if (c.escape != null) {
        if (c.what === 'ship') {
            const ships = g.markers.filter((m) => m.type === 'ship' && (m.status === 'escaped' || m.status === 'board')).length;
            return hasAction(g, seat, 'sail') && ships >= c.escape;
        }
        const planes = Object.values(g.aircraft).filter((a) => a.seat === seat && matches(a, c) && (a.status === 'escaped' || (live(a) && mayEscape(g, a))));
        return planes.length >= c.escape;
    }
    if (c.points != null) return pointsOf(g, seat, c) + pointsLeft(g, seat, c) >= c.points;
    return false;
}

/** The most a points objective can still add (see canWin). */
function pointsLeft(g, seat, c) {
    const per = c.per ?? {};
    let n = canKill(g, seat) ? (per.aircraft ?? 0) * enemyValue(g, seat, {}, live) : 0;
    if (hasAction(g, seat, 'bomb')) for (const m of g.markers) if (m.status === 'board') n += per[m.type] ?? 0;
    for (const a of Object.values(g.aircraft)) if (a.seat === seat && live(a) && mayEscape(g, a)) n += per.escaped?.[TYPES[a.id].aircraft] ?? 0;
    return n;
}

export function endGame(g, winner, how) {
    g.result = { winner, how, round: g.round };
    log(g, 'gameOver', { winner, how });
    throw new GameEnd(how);
}
