// The companion's start screen (docs/02 §8): the notice that it needs the physical game, the scenario with our own
// map and objectives (in our own words, from the win conditions), the player's side and who rolls the computer's
// dice; then the game (play.js). Credits to the designers and the publisher; nothing of the game's art, rules or
// scenario texts. Ported from 61's companion/app.js.

import { h } from '../src/ui/dom.js';
import { t, setLang, getLang, LANGS, LANG_NAMES, EXTRA_LANGS, pickLang, scenarioTitle } from '../src/i18n/index.js';
import { SCENARIOS, SIDES, nameToType } from '../src/engine/data.js';
import { createState, normalizeSetup } from '../src/engine/state.js';
import { view } from '../src/engine/view.js';
import { decodeRecord, replayRecord } from '../src/engine/session.js';
import { sideName } from '../src/ui/text.js';
import { drawMap } from './map.js';
import { cardList } from './names.js';
import { CompanionView, loadSaved, goals, pref, setPref, warmDice } from './play.js';
import { pauseWhenHidden } from '../src/ui/sound.js';
import { CONTACT, SOURCE, VERSION, bugMail, appKind } from './contact.js';

const root = document.getElementById('app');

setLang(new URLSearchParams(location.search).get('lang') ?? pref('lang') ?? pickLang(navigator.languages ?? [navigator.language]));
document.documentElement.lang = getLang();

/** A side's cards in a scenario: the deck it starts with and its supply, as lists of card keys. */
function scenarioCards(sc, seat) {
    const deck = [], supply = [];
    for (const [name, spec] of Object.entries(sc.cards[SIDES[seat]] ?? {})) {
        const key = `${SIDES[seat]}:${nameToType(SIDES[seat], name)}`;
        for (const ch of spec) (ch === 'D' ? deck : supply).push(key);
    }
    return { deck, supply };
}

function setupScreen() {
    let scenario = pref('scenario') ?? 1;
    let side = pref('side') ?? 0;
    let botDice = pref('botDice') ?? 'virtual';
    const info = h('div', { class: 'scen-info' });
    const showInfo = () => {
        const sc = SCENARIOS.find((x) => x.id === scenario);
        const preview = view(createState(normalizeSetup({ scenario })), side);
        const cards = scenarioCards(sc, side);
        info.replaceChildren(
            h('div', { class: 'scen-text' },
                h('h3', {}, `${sc.id}. ${scenarioTitle(sc)}`),
                h('p', {}, t('cmp.setup.mount', { n: sc.id })),
                h('p', {}, t('cmp.goal.initiative', { side: sideName(SIDES.indexOf(sc.initiative)) })),
                h('h4', {}, t('cmp.goal.title')),
                h('ul', {}, [0, 1].map((s) => h('li', {}, h('b', {}, `${sideName(s)}${s === side ? ` (${t('cmp.you')})` : ''}: `), goals(sc, s)))),
                sc.decoys ? h('p', { class: 'small' }, t('cmp.setup.decoys')) : null,
                h('h4', {}, t('cmp.setup.yourCards', { side: sideName(side) })),
                h('p', { class: 'small' }, t('cmp.setup.deck', { cards: cardList(cards.deck) })),
                h('p', { class: 'small' }, t('cmp.setup.supply', { cards: cardList(cards.supply) })),
                h('p', { class: 'small muted' }, t('cmp.setup.botCards', { side: sideName(1 - side) }))),
            h('div', { class: 'scen-map' }, drawMap(preview, { me: side, terrain: pref('terrain') !== false, planes: pref('planes') === true })));
    };
    const select = h('select', { onchange: (e) => { scenario = Number(e.target.value); showInfo(); } },
        SCENARIOS.map((sc) => h('option', { value: sc.id, selected: sc.id === scenario }, `${sc.id}. ${scenarioTitle(sc)}`)));
    const sideSel = h('select', { onchange: (e) => { side = Number(e.target.value); showInfo(); } },
        [0, 1].map((s) => h('option', { value: s, selected: s === side }, sideName(s))));
    const dice = h('select', { onchange: (e) => (botDice = e.target.value) },
        ['virtual', 'physical'].map((v) => h('option', { value: v, selected: v === botDice }, t(`cmp.setup.botDice.${v}`))));
    const mapSel = h('select', { onchange: (e) => { setPref('terrain', e.target.value === 'terrain'); showInfo(); } },
        ['terrain', 'diagram'].map((v) => h('option', { value: v, selected: (v === 'terrain') === (pref('terrain') !== false) }, t(`cmp.setup.map.${v}`))));
    const planesSel = h('select', { onchange: (e) => { setPref('planes', e.target.value === 'planes'); showInfo(); } },
        ['text', 'planes'].map((v) => h('option', { value: v, selected: (v === 'planes') === (pref('planes') === true) }, t(`cmp.setup.counters.${v}`))));
    const code = h('input', { placeholder: 'UBB1.…', size: 18 });
    const err = h('span', { class: 'error small' });
    const saved = loadSaved();
    showInfo();
    root.replaceChildren(h('div', { class: 'setup' },
        h('header', { class: 'bar' }, h('strong', {}, t('cmp.title')), h('span', { class: 'muted sub' }, t('cmp.subtitle')), h('span', { class: 'grow' }),
            h('select', { class: 'lang', 'aria-label': 'Language', onchange: (e) => { const l = e.target.value; setPref('lang', l); setLang(l); document.documentElement.lang = l; setupScreen(); } },
                LANGS.map((l) => h('option', { value: l, selected: l === getLang() }, LANG_NAMES[l] ?? l)))),
        h('p', { class: 'notice' }, t('cmp.notice')),
        h('div', { class: 'setup-body' },
            h('div', { class: 'form' },
                h('label', {}, t('cmp.setup.scenario'), select),
                h('label', {}, t('cmp.setup.side'), sideSel),
                h('label', {}, t('cmp.setup.botDice'), dice),
                h('label', {}, t('cmp.setup.map'), mapSel),
                h('label', {}, t('cmp.setup.counters'), planesSel),
                h('button', { class: 'primary', onclick: () => {
                    setPref('scenario', scenario);
                    setPref('side', side);
                    setPref('botDice', botDice);
                    start({ setup: { scenario, seed: Math.random().toString(36).slice(2, 10), external: side, botDice } });
                } }, t('cmp.setup.start')),
                saved ? h('button', { onclick: () => start(saved) }, t('cmp.setup.continue')) : null,
                h('details', {}, h('summary', {}, t('cmp.setup.code')),
                    h('div', { class: 'row' }, code, h('button', { onclick: async () => {
                        try {
                            const rec = await decodeRecord(code.value);
                            if (rec.setup.external == null) throw Object.assign(new Error(), { key: 'cmp.setup.notCompanion' });
                            const r = replayRecord(rec);
                            if (r.failedAt != null) err.textContent = t('cmp.setup.changed', { n: r.failedAt + 1 });
                            start({ setup: rec.setup, answers: r.session.answers });
                        } catch (e) {
                            err.textContent = e.key ? t(e.key) : e.message;
                        }
                    } }, t('cmp.setup.load'))), err)),
            info),
        h('footer', { class: 'credits small muted' }, h('p', {}, t('cmp.credits')), h('p', {}, t('cmp.credits.art')), h('p', {}, t('cmp.credits.sounds')),
            EXTRA_LANGS.map((l) => h('p', { lang: l.code }, l.credit)),
            h('p', {}, `Britain Companion ${VERSION} · `, h('a', { href: SOURCE, target: '_blank', rel: 'noopener' }, t('cmp.source')),
                CONTACT ? [' · ', h('a', { href: bugMail(CONTACT, { app: appKind(), agent: navigator.userAgent }).url }, t('cmp.bug'))] : null))));
}

// a game is a step of the page's history: Back returns to the start screen, with the game saved
let current = null;

function start(game) {
    if (!history.state?.game) history.pushState({ game: true }, '');
    current = new CompanionView(root, game, { onExit: leave });
}

function leave() {
    current = null;
    if (history.state?.game) history.go(history.state.modal ? -2 : -1);
    setupScreen();
}

window.addEventListener('popstate', () => {
    if (!current) return;
    if (!history.state?.modal) current.closeModal();
    if (history.state?.game) return;
    current.dispose();
    current = null;
    setupScreen();
});

pauseWhenHidden();
if (history.state) history.replaceState(null, '');
setupScreen();
if (pref('dice3d') !== false) warmDice();
