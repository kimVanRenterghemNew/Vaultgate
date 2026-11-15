import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromEnv } from '../legacy-name/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const I18N = path.join(ROOT, 'i18n');

const read = file => JSON.parse(fs.readFileSync(path.join(I18N, file), 'utf8'));

const flatten = (tree, prefix = '', out = {}) => {
    for (const [key, value] of Object.entries(tree)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, full, out);
        else out[full] = String(value);
    }
    return out;
};

const CATALOGS = Object.freeze({
    en: flatten(read('en.json')),
    nl: flatten(read('nl.json')),
});

export const LANGUAGES = Object.freeze(Object.keys(CATALOGS));

const base = value => {
    if (typeof value !== 'string' || !value.trim()) return null;
    const short = value.trim().toLowerCase().replace('_', '-').split('.')[0].split('@')[0].split('-')[0];
    return LANGUAGES.includes(short) ? short : null;
};

export const chooseLanguage = candidates => {
    for (const candidate of candidates) {
        const picked = base(candidate);
        if (picked) return picked;
    }
    return 'en';
};

export const appLanguage = (env = process.env) => chooseLanguage([fromEnv(env, 'VAULTGATE_LANG'), env.LC_ALL, env.LANG, env.LANGUAGE]);

const format = (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));

export const t = (lang, key, params = {}) => format(CATALOGS[lang]?.[key] ?? CATALOGS.en[key] ?? key, params);

export const translator = lang => (key, params = {}) => t(lang, key, params);

export function pickPrefix(lang, prefix) {
    const source = CATALOGS[lang] ?? CATALOGS.en;
    const out = {};
    for (const [key, value] of Object.entries(source)) if (key.startsWith(prefix)) out[key] = value;
    return out;
}
