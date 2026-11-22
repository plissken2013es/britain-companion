// The cards panel, two ways (docs/02 §8.15), ported from 61's companion/cards.js (PRs #1 and #2 of its public
// repository, by Albert Gil): 'player', one panel per player; 'compared', one panel with both players side by side
// pile by pile and sections that fold. The same cards either way, only laid out differently. `detail`, in either:
// besides how many cards are in deck and hand, which ones are there and in play. The view is chosen on the start
// screen and in ☰, the detail in ☰. The piles come from playersAt() (guide.js), as { key: n }, so the panel never
// gets ahead of the steps.

import { h } from '../src/ui/dom.js';
import { t } from '../src/i18n/index.js';
import { scenarioById, nameToType, SIDES } from '../src/engine/data.js';
import { cardName, sideName } from '../src/ui/text.js';

export const CARD_VIEWS = ['player', 'compared'];

/** The player's choices from their preferences: the view ('player' by default) and the detail (on by default). */
export function cardsChoice({ cards, detail } = {}) {
    return { view: CARD_VIEWS.includes(cards) ? cards : 'player', detail: detail ?? true };
}

/** A { key: n } count as [[key, n], …], without the empty ones. */
const typeCounts = (cards) => Object.entries(cards ?? {}).filter(([, k]) => k > 0);

/** How many cards in a { key: n } count. */
const size = (cards) => typeCounts(cards).reduce((n, [, k]) => n + k, 0);

const counted = ([key, k]) => `${cardName(key)}${k > 1 ? ` ×${k}` : ''}`;

/** "Y1 Hurricane ×2, Discordia" from a { key: n } count. */
const cardList = (cards) => typeCounts(cards).map(counted).join(', ');

/** "RAF (tú)", "Luftwaffe (el ordenador)": the same pattern for both sides (61's PR #1). */
export const sideLabel = (seat, me) => `${sideName(seat)} (${t(seat === me ? 'cmp.you' : 'cmp.bot')})`;

/**
 * A side's cards in hand, deck and play, as { key: n }. The player's hand and deck are counted by the app (`hidden`);
 * the computer's are all its cards (the scenario's table) less its supply, discard pile and the Discords set aside,
 * which anyone may count, as a player taking notes would; never in which order. Null for the computer once it has
 * lost cards: the view does not say which.
 */
export function handDeckPlay(view, seat) {
    const p = view.players[seat];
    if (p.hidden) {
        const n = { ...p.hidden };
        for (const [key, k] of typeCounts(p.play)) n[key] = (n[key] ?? 0) + k;
        return n;
    }
    if (p.removedCount) return null;
    const side = SIDES[seat];
    const n = {};
    for (const [name, where] of Object.entries(scenarioById(view.scenario).cards?.[side] ?? {})) n[`${side}:${nameToType(side, name)}`] = where.length;
    for (const pile of [p.supply, p.discard]) for (const [key, k] of typeCounts(pile)) n[key] -= k;
    if (p.aside) n[`${side}:discord`] -= p.aside;
    return n;
}

/**
 * The detail of a side's hand, deck and play: one entry per type, with the play letter (cmp.cards.playTag) once per
 * copy in play, "Y1 Hurricane ×3 (JJ)"; for the computer with lost cards, only its play.
 */
function detailLines(view, seat) {
    const p = view.players[seat];
    const inPlay = new Map(typeCounts(p.play));
    const line = ([key, k]) => `${counted([key, k])}${inPlay.get(key) ? ` (${t('cmp.cards.playTag').repeat(inPlay.get(key))})` : ''}`;
    return typeCounts(handDeckPlay(view, seat) ?? p.play).map(line);
}

/** The label of the detail row: the computer with lost cards only shows its play. */
const detailLabel = (view, seat) => t(handDeckPlay(view, seat) ? 'cmp.cards.handDeckPlay' : 'cmp.cards.play');

/** The panels for the player's choice of view; `fold` keeps the sections folded in 'compared'. */
export function cardPanels(viewName, view, me, { detail = true, fold } = {}) {
    if (viewName === 'compared') return [['cards', cardsPanel(view, me, { detail, fold })]];
    return [['mine', sidePanel(view, me, me, { detail })], ['bot', sidePanel(view, 1 - me, me, { detail })]];
}

/** One side's cards: how many in hand and deck, the rest pile by pile. */
function sidePanel(view, seat, me, { detail }) {
    const p = view.players[seat];
    const row = (label, text) => [h('b', {}, label), h('span', {}, text || '—')];
    const mine = seat === me;
    return h('details', { class: `info deck-panel ${SIDES[seat]}` },
        h('summary', {}, `${sideLabel(seat, me)} · ${t('cmp.cards.counts', { hand: p.handCount, deck: p.deckCount })}`),
        h('div', { class: 'piles' },
            detail ? row(detailLabel(view, seat), detailLines(view, seat).join(', ')) : row(t('cmp.cards.play'), cardList(p.play)),
            row(t('cmp.cards.discard'), cardList(p.discard)),
            row(t('cmp.cards.supply'), cardList(p.supply)),
            row(t('cmp.cards.removed'), mine && p.removed ? cardList(p.removed) : p.removedCount ? String(p.removedCount) : ''),
            p.aside ? row(t('cmp.cards.aside'), String(p.aside)) : null));
}

/** One pile as a column, a line per type of card. */
const pileCol = (cards, right = false) => {
    const types = typeCounts(cards);
    return h('div', { class: `cards-col${right ? ' right' : ''}` }, types.length ? types.map((x) => h('div', {}, counted(x))) : '—');
};

/** Lines as a column. */
const linesCol = (lines, right = false) => h('div', { class: `cards-col${right ? ' right' : ''}` }, lines.length ? lines.map((x) => h('div', {}, x)) : '—');

/**
 * Both players side by side, pile by pile, so the same pile compares at a glance; each section folds (`fold`:
 * { collapsed, toggle(key) }). The computer's lost cards are a count: the view does not say which.
 */
function cardsPanel(view, me, { detail, fold = { collapsed: {}, toggle: () => {} } }) {
    const bot = 1 - me;
    const [mp, bp] = [view.players[me], view.players[bot]];
    const title = (key, lines) => h('div', { class: 'cards-title', onclick: () => fold.toggle(key) },
        lines.map((text, i) => h('div', {}, i ? text : `${fold.collapsed[key] ? '▸' : '▾'} ${text}`)));
    // how many in deck and hand, and in play too with the detail (the lines under them name them all)
    const counts = (p) => [p.deckCount, p.handCount, ...(detail ? [size(p.play)] : [])].join(' / ');
    const section = (key, label, a, b) => (fold.collapsed[key] ? [title(key, [label])] : [title(key, [label]), a, b]);
    return h('details', { class: 'info cards-panel' },
        h('summary', {}, t('cmp.cards.title')),
        h('div', { class: 'cards-grid' },
            h('div', { class: 'cards-head' }, sideName(me), h('div', {}, `(${t('cmp.you')})`)),
            h('div', { class: 'cards-head right' }, sideName(bot), h('div', {}, `(${t('cmp.bot')})`)),
            title('handDeck', detail ? [t('cmp.cards.deckHandPlay')] : [t('cmp.cards.deckHand'), t('cmp.cards.play')]),
            ...(fold.collapsed.handDeck ? [] : [
                h('div', { class: 'cards-col' }, counts(mp)),
                h('div', { class: 'cards-col right' }, counts(bp)),
                ...(detail ? [linesCol(detailLines(view, me)), linesCol(detailLines(view, bot), true)] : [pileCol(mp.play), pileCol(bp.play, true)])]),
            ...section('discard', t('cmp.cards.discard'), pileCol(mp.discard), pileCol(bp.discard, true)),
            ...section('supply', t('cmp.cards.supply'), pileCol(mp.supply), pileCol(bp.supply, true)),
            ...section('removed', t('cmp.cards.removed'), mp.removed ? pileCol(mp.removed) : linesCol(mp.removedCount ? [String(mp.removedCount)] : []),
                linesCol(bp.removedCount ? [String(bp.removedCount)] : [], true)),
            ...(mp.aside || bp.aside ? section('aside', t('cmp.cards.aside'), linesCol(mp.aside ? [String(mp.aside)] : []), linesCol(bp.aside ? [String(bp.aside)] : [], true)) : [])));
}
