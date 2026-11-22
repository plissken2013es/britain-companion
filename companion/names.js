// Names the companion shows: aircraft with the letter of their pair (scenario 9: the two counters of a pair look
// the same on the table, so the app calls them "a" and "b"), directions and lists of cards.

import { t } from '../src/i18n/index.js';
import { TYPES, baseId } from '../src/engine/data.js';
import { aircraftName, cardName, unitLabel } from '../src/ui/text.js';

/** "a" / "b" for a paired counter's public alias ("luftwaffe:G1@2" → "b"), or "". */
export const pairLetter = (pub) => (pub?.includes('@') ? 'ab'[Number(pub.split('@')[1]) - 1] : '');

/**
 * An aircraft by any id the log or a view uses: its type, the letter of its pair, and for the player's own counters
 * whether it is the decoy (they set them out, so they know).
 */
export function planeName(id, view, me) {
    const own = view && Object.values(view.aircraft).find((a) => a.seat === me && (a.id === id || a.pub === id));
    const pub = own ? own.pub ?? own.id : id;
    const letter = pairLetter(pub);
    const base = own ? aircraftName(own.id) : aircraftName(id);
    return letter ? `${cardName(baseId(id))} ${letter}${own?.decoy ? ` (${t('card.decoy')})` : ''}` : base;
}

/** The counter's short label: "Y1", "B" (an ace's star is drawn by the map), with the pair letter. */
export function shortLabel(a) {
    const type = TYPES[baseId(a.id)];
    return `${unitLabel(type.id).replace('★', '')}${pairLetter(a.pub ?? a.id)}`;
}

export const isAce = (a) => TYPES[baseId(a.id)].rank === 'ace';

export const dirName = (facing) => t(`cmp.dir.${facing}`);

/** "Y2 Hurricane (4)": a card as a button, with its initiative (61's PR #1); a Discord has none. */
export function cardLabel(key) {
    const n = TYPES[key]?.initiative;
    return n != null ? `${cardName(key)} (${n})` : cardName(key);
}

/** "Y1 Hurricane ×2, Discordia" from a list of card keys. */
export function cardList(keys) {
    const n = new Map();
    for (const k of keys) n.set(k, (n.get(k) ?? 0) + 1);
    return [...n].map(([k, c]) => `${cardName(k)}${c > 1 ? ` ×${c}` : ''}`).join(', ');
}
