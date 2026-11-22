// Interface languages (docs/02 §2.5). Spanish and English live in es.js / en.js (+ companion.js) as flat keys. Any
// other language is one file in lang/ with the companion's texts and, if its edition of the game translates them, the
// scenario titles (docs/02 §8.7, point 5; as in 61).
import es from './es.js';
import en from './en.js';
import * as companion from './companion.js';
import extra from './lang/index.js';

// the companion's texts (companion.js) live in a file of their own, so the public build can take only those
const DICTS = { es: { ...es, ...companion.es }, en: { ...en, ...companion.en } };
/** Each language's name, in that language (the language menu). */
export const LANG_NAMES = { es: 'Español', en: 'English' };
/** Scenario titles by language, where its edition of the game translates them ({ s01: '…' }). */
const TITLES = {};
for (const l of extra) {
    DICTS[l.code] = l.texts;
    LANG_NAMES[l.code] = l.name;
    TITLES[l.code] = l.scenarios ?? {};
}

export const LANGS = Object.keys(DICTS);
/** The other languages' files (credits, tests). */
export const EXTRA_LANGS = extra;
let lang = 'es';

export function setLang(l) {
    if (DICTS[l]) lang = l;
    return lang;
}

export function getLang() {
    return lang;
}

/** The best language for a browser's list of preferred languages (navigator.languages), English if none. */
export function pickLang(preferred = []) {
    for (const p of preferred) {
        const l = String(p).toLowerCase();
        if (DICTS[l]) return l;
        if (DICTS[l.split('-')[0]]) return l.split('-')[0];
    }
    return 'en';
}

/**
 * t('catalog.faces', { n: 6 }) — {name} placeholders; a function entry gets the params (plurals).
 * Falls back to English, then Spanish, then to the key itself, so a missing text is visible instead of blank (a
 * text added later shows in English in the other languages until it is translated).
 */
export function t(key, params = {}) {
    const s = DICTS[lang][key] ?? DICTS.en[key] ?? DICTS.es[key] ?? key;
    if (typeof s === 'function') return s(params);
    return s.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
}

/** Pick the active language from a data pair such as region.name = { es, en }. */
export function tr(pair) {
    return pair?.[lang] ?? pair?.en ?? pair?.es ?? '';
}

/** A scenario's title: as the edition of the game in this language prints it, if its file gives one; else the book's. */
export const scenarioTitle = (sc) => TITLES[lang]?.[`s${String(sc.id).padStart(2, '0')}`] ?? sc.title;

export const dictionaries = DICTS;
