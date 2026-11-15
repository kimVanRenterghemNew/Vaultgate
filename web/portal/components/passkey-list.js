// De sleutels van de kluis: welke er zijn (eigen naam of soort, met icoon), laatst gebruikt, en of ze de kluis openen of
// alleen aanmelden (zonder PRF). Eén lijst in de pagina; het welkom en Authentication zetten ze in hun eigen vak
// (place). In Authentication kies je een passkey en staat rechts (#pk-detail) wat ze doet,
// met hernoemen, verwijderen en tijdelijk blokkeren (ks-pause): een geblokkeerde passkey telt niet voor aanmelden of
// aanraken, en de laatste blokkeren weigert het portaal. Minstens twee: de tweede wordt aangeraden. Toevoegen is
// ks-passkey-add. Na verwijderen: event `passkeys-changed`.
import { api, $, t, clone, date, clock, define, state, inspector } from '../core/index.js';
import { ask } from './ask.js';
import { blockControl } from './pause.js';
import template from './passkey-list.html';

// De soort volgt uit de transports van de passkey.
const KINDS = [['hybrid', 'phone', 'i-phone'], ['internal', 'thisPc', 'i-laptop'], ['usb', 'securityKey', 'i-key'], ['nfc', 'securityKey', 'i-key'], ['ble', 'securityKey', 'i-key']];
const kindOf = transports => KINDS.find(([tr]) => (transports ?? []).includes(tr)) ?? [null, 'unknown', 'i-key'];

define('ks-passkey-list', {
  template,
  async load() {
    const passkeys = state().vaultExists ? await api('GET', '/api/passkeys') : [];
    // Kiezen, het detail en blokkeren alleen in Authentication, niet in het welkom (daar maak je je eerste passkeys).
    const inAuthentication = this.parentElement?.id === 'passkeys-slot';
    const blocks = inAuthentication && passkeys.length > 1 ? await api('GET', '/api/blocks') : null;
    const fields = p => {
      const [, kind] = kindOf(p.transports);
      const label = t('portal.passkeys.kind.' + kind);
      return { title: p.name || label, kind: label, prf: p.prf, label, used: p.lastUsedAt ? date(p.lastUsedAt) + ' ' + clock(p.lastUsedAt) : '' };
    };
    const detail = p => {
      const f = fields(p);
      return clone(this, 'detail', {
        ...f, added: date(p.createdAt),
        pause: blocks ? blockControl('passkey-block', blocks, { kind: 'passkey', passkeyId: p.id }, () => this.load()) : '',
      }, {
        rename: async () => {
          const name = await ask(t('portal.passkeys.renamePrompt'), { input: 'text', value: p.name, ok: 'portal.keys.editSave' });
          if (name !== null) { await api('PUT', '/api/passkeys/' + p.id + '/name', { name }); await this.load(); }
        },
        remove: async () => { if (await ask(t('portal.passkeys.removeConfirm', { name: f.title }), { ok: 'portal.passkeys.remove' })) { await api('DELETE', '/api/passkeys/' + p.id); this.dispatchEvent(new CustomEvent('passkeys-changed', { bubbles: true })); } },
      });
    };
    const rows = passkeys.map(p => {
      const f = fields(p);
      const row = clone(this, 'item', { ...f, note: [f.label, f.used && t('portal.passkeys.lastUsed', { date: f.used })].filter(Boolean).join(', ') });
      row.querySelector('[data-icon]').setAttribute('href', '#' + kindOf(p.transports)[2]);
      row.dataset.prf = String(p.prf);
      return { row, item: p };
    });
    if (inAuthentication) {
      $('pk-list').setAttribute('role', 'listbox');
      inspector($('pk-list'), $('pk-detail'), rows, { keyOf: p => p.id, render: detail });
    } else {
      $('pk-list').removeAttribute('role');
      $('pk-list').replaceChildren(...rows.map(r => r.row));
    }
    $('pk-list').classList.toggle('hidden', passkeys.length === 0);
    $('pk-recommend').classList.toggle('hidden', passkeys.length !== 1);
    this.dataset.count = String(passkeys.length);
    this.dataset.opens = String(passkeys.filter(p => p.prf).length);
  },
});
