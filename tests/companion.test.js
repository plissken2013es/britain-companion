// The companion (docs/02 §8): the table and the cards it shows after each step must be the engine's once all the steps
// are done (boardAt / playersAt, 61 §7.9: its PR #2), every step must have its text in both languages, and the
// objectives are told in our own words for every scenario.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../src/engine/data.js';
import { Session } from '../src/engine/session.js';
import { createState, normalizeSetup } from '../src/engine/state.js';
import { view as viewOf } from '../src/engine/view.js';
import { setLang } from '../src/i18n/index.js';
import { randomBot } from '../src/ai/randomBot.js';
import { heuristicBot } from '../src/ai/heuristicBot.js';
import { boardAt, guideSteps } from '../companion/guide.js';
import { logLine } from '../src/ui/text.js';
import { goals, progressOf } from '../companion/goals.js';
import { handDeckPlay } from '../companion/cards.js';
import es from '../src/i18n/es.js';
import * as companion from '../src/i18n/companion.js';

const keyOf = (cid) => cid.slice(0, cid.lastIndexOf(':'));
function counts(cards) {
    const n = {};
    for (const c of cards) n[keyOf(c)] = (n[keyOf(c)] ?? 0) + 1;
    return n;
}
const bad = (s) => typeof s !== 'string' || /\{\w+\}|undefined|NaN|\bcmp\.|^(log|ask|opt|action)\./.test(s);

/** What the map and the cards panel show of a view, to compare the companion's with the engine's. */
function table(v) {
    const planes = Object.values(v.aircraft).filter((a) => a.status !== 'deploy')
        .map((a) => `${a.pub ?? a.id} ${a.status} ${a.status === 'board' ? `${a.hex} ${a.facing} ${a.ready}` : ''}`).sort();
    const markers = v.markers.map((m) => `${m.id} ${m.status} ${m.hex}`);
    const cards = v.players.map((p) => {
        const pile = (x) => (Array.isArray(x) ? counts(x) : x);
        const sorted = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, k]) => k).sort());
        return { hand: p.handCount, deck: p.deckCount, discard: sorted(pile(p.discard)), play: sorted(pile(p.play)), supply: sorted(pile(p.supply)),
            removed: p.removedCount, aside: p.aside, hidden: p.hidden && sorted(pile(p.hidden)) };
    });
    return { planes, markers, cards };
}

test('after every answer, the steps rebuild the engine\'s table and cards, and say everything in both languages', () => {
    for (const lang of ['es', 'en']) {
        setLang(lang);
        for (const sc of SCENARIOS) {
            for (const me of [0, 1]) {
                const s = new Session({ scenario: sc.id, seed: `cmp${sc.id}${me}${lang}`, external: me, botDice: me ? 'physical' : 'virtual' });
                const bots = [0, 1].map((k) => (k === me ? randomBot(`r${sc.id}${me}`) : heuristicBot(`h${sc.id}${me}`)));
                // as the companion does: a new game's steps start from the table as set up
                let before = viewOf(createState(s.setup), me);
                let logStart = 0;
                let n = 0;
                const check = () => {
                    const entries = s.state.log.slice(logStart);
                    const steps = guideSteps(entries, me, before);
                    for (const e of entries) assert.ok(!bad(logLine(e, before)), `${lang} s${sc.id} log ${e.k}: ${logLine(e, before)}`);
                    for (const st of steps) {
                        for (const text of [st.text, st.head, st.after, ...(st.lines ?? [])].filter((x) => x != null)) assert.ok(!bad(text), `${lang} s${sc.id}: ${text}`);
                        assert.ok(st.at >= 0 && st.at < entries.length);
                    }
                    if (entries.length) {
                        const board = boardAt(before, entries, entries.length - 1);
                        const shown = table(board);
                        const real = table(s.view(me));
                        assert.deepEqual(shown, real, `s${sc.id} seat ${me}, answer ${n}`);
                        // the cards panel's detail (cards.js): each side's hand, deck and play as the engine has them
                        for (const seat of [0, 1]) {
                            const counted = handDeckPlay(board, seat);
                            if (!counted) continue; // the computer once it has lost cards: only its play is shown
                            const p = s.state.players[seat];
                            const sorted = (o) => Object.fromEntries(Object.entries(o).filter(([, k]) => k).sort());
                            assert.deepEqual(sorted(counted), sorted(counts([...p.hand, ...p.deck, ...p.play])), `s${sc.id} seat ${me}, cards of ${seat}, answer ${n}`);
                        }
                    }
                };
                for (; !s.over && n < 5000; n++) {
                    const req = s.pending;
                    if (req.seat === me) {
                        check();
                        before = structuredClone({ ...s.view(me), log: [] });
                        logStart = s.state.log.length;
                    }
                    s.act(bots[req.seat](req, s.view(req.seat)));
                }
                assert.ok(s.state.result, `s${sc.id}: the game ends`);
                check();
            }
        }
    }
});

test('objectives in our own words for every scenario and side, with their progress', () => {
    for (const lang of ['es', 'en']) {
        setLang(lang);
        for (const sc of SCENARIOS) {
            const v = viewOf(createState(normalizeSetup({ scenario: sc.id })), 0);
            for (const seat of [0, 1]) {
                const text = goals(sc, seat);
                assert.ok(text.length > 10 && !bad(text), `${lang} s${sc.id}: ${text}`);
                for (const c of sc.win[['raf', 'luftwaffe'][seat]]) assert.match(progressOf(v, seat, c), /^0\/\d+( \+ 0\/\d+)*$/);
            }
        }
    }
});

test('the companion\'s texts exist in both languages, and none of the book\'s', () => {
    assert.deepEqual(Object.keys(companion.es).sort(), Object.keys(companion.en).sort());
    for (const k of Object.keys(companion.es)) assert.ok(k.startsWith('cmp.'), k);
    for (const k of Object.keys(companion.es)) assert.ok(!(k in es), `${k} is also a text of the full app`);
});

test('the companion\'s own art: a picture for every aircraft type, and every texture the map asks for', async () => {
    const { existsSync } = await import('node:fs');
    const { TYPES } = await import('../src/engine/data.js');
    const { planeArt } = await import('../companion/map.js');
    for (const type of Object.values(TYPES)) if (type.kind === 'combat') assert.ok(existsSync(planeArt(type)), planeArt(type));
    for (const [kind, n] of [['sea', 3], ['land', 4]]) for (let i = 1; i <= n; i++) assert.ok(existsSync(`assets/companion/terrain/${kind}-${i}.png`));
});
