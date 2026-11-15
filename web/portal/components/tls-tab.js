// Het tabblad Certificates als inspector: links eerst de ketens die op jou wachten (een nieuwe root die je niet
// vertrouwt: tls-chain-changed of tls-untrusted), dan de roots die je vertrouwt; rechts de gekozen: eerder en nu,
// vingerafdruk en "vergelijk en beslis", of de reikwijdte, wanneer vertrouwd en intrekken. Een vernieuwd certificaat
// onder dezelfde root of een root die Node en Mozilla vertrouwen, komt hier niet: dat vraagt niets van jou.
// Intro-dialoog met inspectiewaarschuwing bij het eerste bezoek, scopekeuze en intrekken in dialogen.
import { api, t, clone, guarded, define, date, domain, inspector } from '../core/index.js';
import screen from './tls-tab.html';
import dialogs from './tls-dialogs.html';

const template = screen + dialogs;

const INTRO_KEY = 'vaultgate.tls-intro-seen';

function shortFp(fp) {
  if (!fp || typeof fp !== 'string') return '-';
  return fp.length > 24 ? fp.slice(0, 23) + '…' : fp;
}

function openTrustDialog(self, c) {
  self.currentPending = c;
  const issuer = c.observedIssuer || c.observedRoot || '-';
  const dialog = self.querySelector('#tls-trust-dialog');
  self.querySelector('#tls-trust-heading').textContent = t('portal.tls.trustTitle', { root: issuer });
  self.querySelector('#tls-trust-warn-text').textContent = t('portal.tls.trustWarn', { root: issuer });
  self.querySelector('#tls-trust-issuer').textContent = issuer;
  self.querySelector('#tls-trust-fingerprint').textContent = c.fingerprint || c.observedRoot || '-';
  self.querySelector('#tls-trust-scope-host-label').textContent = t('portal.tls.scopeHostTitle', { origin: c.origin });
  dialog.showModal();
}

function openUntrustDialog(self, tr) {
  self.currentRevoke = tr;
  const name = tr.issuer || tr.origin || '-';
  const dialog = self.querySelector('#tls-untrust-dialog');
  self.querySelector('#tls-untrust-heading').textContent = t('portal.tls.untrustTitle', { root: name });
  self.querySelector('#tls-untrust-desc').textContent = t('portal.tls.untrustDesc', { root: name });
  dialog.showModal();
}

function openDetailsDialog(self, tr) {
  const dialog = self.querySelector('#tls-details-dialog');
  self.querySelector('#tls-details-heading').textContent = tr.issuer || '-';
  self.querySelector('#tls-details-issuer').textContent = tr.issuer || '-';
  self.querySelector('#tls-details-fingerprint').textContent = tr.fingerprint || tr.root || '-';
  self.querySelector('#tls-details-valid').textContent = tr.validTo ? `${tr.validFrom || ''} - ${tr.validTo}` : '-';
  self.querySelector('#tls-details-scope').textContent = tr.scope === 'global' || tr.origin === '*' ? t('portal.tls.scopeGlobal') : tr.origin;
  dialog.showModal();
}

async function loadReview(self) {
  const list = self.querySelector('#tls-review-list');
  const empty = self.querySelector('#tls-review-empty');
  list.replaceChildren();
  let roots = [];
  try { roots = await api('GET', '/api/tls/added-roots'); } catch { /* ignore */ }
  if (!roots || roots.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  for (const r of roots) {
    const row = clone(self, 'review-row', {
      subject: r.subject || r.issuer || '-',
      fingerprint: shortFp(r.fingerprint256 || r.fingerprint),
    });
    list.appendChild(row);
  }
}

define('ks-tls-tab', {
  template,
  wire() {
    this.currentPending = null;
    this.currentRevoke = null;

    const dialogIntro = this.querySelector('#tls-intro-dialog');
    const dialogTrust = this.querySelector('#tls-trust-dialog');
    const dialogUntrust = this.querySelector('#tls-untrust-dialog');
    const dialogReview = this.querySelector('#tls-review-dialog');

    this.querySelector('[data-action="open-intro"]')?.addEventListener('click', () => dialogIntro.showModal());
    dialogIntro?.addEventListener('close', () => {
      try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* ignore */ }
    });

    this.querySelector('[data-action="open-review"]')?.addEventListener('click', () => guarded(async () => {
      await loadReview(this);
      dialogReview.showModal();
    }));

    this.querySelector('[data-action="trust-touch"]')?.addEventListener('click', () => guarded(async () => {
      if (!this.currentPending) return;
      const scope = this.querySelector('input[name="trust-scope"]:checked')?.value ?? 'host';
      await api('POST', '/api/tls/accept', { origin: this.currentPending.origin, scope });
      dialogTrust.close();
      this.currentPending = null;
      await this.load();
    }));

    this.querySelector('[data-action="confirm-untrust"]')?.addEventListener('click', () => guarded(async () => {
      if (!this.currentRevoke) return;
      await api('POST', '/api/tls/revoke', { origin: this.currentRevoke.origin, root: this.currentRevoke.root });
      dialogUntrust.close();
      this.currentRevoke = null;
      await this.load();
    }));
  },

  async load() {
    // Eerste bezoek? Toon de introductie-popup met inspectiewaarschuwing
    let seenIntro = false;
    try { seenIntro = Boolean(localStorage.getItem(INTRO_KEY)); } catch { /* ignore */ }
    const dialogIntro = this.querySelector('#tls-intro-dialog');
    if (!seenIntro && dialogIntro && typeof dialogIntro.showModal === 'function') {
      try { dialogIntro.showModal(); } catch { /* ignore */ }
    }

    const [pending, trusted] = await Promise.all([
      api('GET', '/api/tls'),
      api('GET', '/api/tls/trusted'),
    ]);

    const broken = c => {
      const root = c.observedIssuer || c.observedRoot || '-';
      return clone(this, 'broken-detail', {
        kind: c.kind, before: c.pinnedIssuer || c.pinnedRoot || t('portal.tls.noEarlier'), now: root,
        description: t(c.kind === 'tls-chain-changed' ? 'portal.tls.changedNote' : 'portal.tls.untrustedNote', { host: domain(c.origin), root }),
        fingerprint: shortFp(c.fingerprint), validTo: c.validTo ?? '-',
      }, { 'review-trust': () => openTrustDialog(this, c) });
    };
    const scopeOf = tr => (tr.scope === 'global' || tr.origin === '*');
    const trust = tr => clone(this, 'trusted-detail', {
      reading: t(scopeOf(tr) ? 'portal.tls.trustedAll' : 'portal.tls.trustedOne'), globalScope: scopeOf(tr), hostScope: !scopeOf(tr),
      hostNote: t('portal.tls.hostNote', { origin: domain(tr.origin) }),
      fingerprint: shortFp(tr.fingerprint || tr.root), validTo: tr.validTo ?? '', trustedAt: tr.updatedAt ? date(tr.updatedAt) : '',
    }, {
      details: () => openDetailsDialog(this, tr),
      'revoke-trust': () => openUntrustDialog(this, tr),
    });
    const rows = [
      ...pending.map(c => ({ row: clone(this, 'broken-row', { kind: c.kind, root: c.observedIssuer || c.observedRoot || '-', host: domain(c.origin) }), item: { key: 'p' + c.origin, render: () => broken(c) } })),
      ...(trusted ?? []).map(tr => ({
        row: clone(this, 'trusted-row', { issuer: tr.issuer || '-', scope: scopeOf(tr) ? t('portal.tls.allDomains') : domain(tr.origin), globalScope: scopeOf(tr), hostScope: !scopeOf(tr) }),
        item: { key: 't' + tr.origin + tr.root, render: () => trust(tr) },
      })),
    ];
    this.querySelector('#tls-waits').textContent = pending.length ? t('portal.tls.waits', { count: pending.length }) : '';
    this.querySelector('#tls-trusted-empty').classList.toggle('hidden', (trusted ?? []).length > 0);
    inspector(this.querySelector('#tls-list'), this.querySelector('#tls-detail'), rows, { keyOf: x => x.key, render: x => x.render(), empty: () => clone(this, 'pick') });
  },
});
