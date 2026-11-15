// Een doelhost met een andere certificaatketen dan eerder (mogelijk een onderschepper). Er gaat geen secret meer
// naartoe tot de gebruiker de nieuwe keten vertrouwt. Eén waarschuwing per host, uit de data.
// Eerder en nu naast elkaar, niet vertrouwen voorop, 1,5 s vertraging op vertrouwen.
import { api, t, clone, define } from '../core/index.js';
import template from './tls.html';

const DISMISS_PREFIX = 'vaultgate.tls-dismissed.';

function shortFp(fp) {
  if (!fp || typeof fp !== 'string') return '-';
  return fp.length > 24 ? fp.slice(0, 23) + '…' : fp;
}

define('ks-tls', {
  template,
  async load() {
    const changes = await api('GET', '/api/tls');
    const active = changes.filter(c => {
      try {
        const hash = c.observedFingerprint || c.fingerprint || c.observedRoot || 'dismissed';
        return localStorage.getItem(DISMISS_PREFIX + c.origin) !== hash;
      } catch {
        return true;
      }
    });

    this.classList.toggle('hidden', active.length === 0);
    this.querySelectorAll('[role=alert]').forEach(n => n.remove());

    for (const c of active) {
      const host = new URL(c.origin).host;
      const isUntrusted = c.kind === 'tls-untrusted';
      const beforeIssuer = c.pinnedIssuer || t('portal.tls.noEarlier');
      const nowIssuer = c.observedIssuer || '-';
      const beforeRoot = shortFp(c.pinnedRoot);
      const nowRoot = shortFp(c.observedRoot);
      const beforeValid = c.pinnedValidTo || '-';
      const nowValid = c.observedValidTo || c.validTo || '-';
      const beforeFp = shortFp(c.pinnedFingerprint);
      const nowFp = shortFp(c.observedFingerprint || c.fingerprint);

      let armed = false;
      let node;

      const actions = {
        untrust: () => {
          try {
            const hash = c.observedFingerprint || c.fingerprint || c.observedRoot || 'dismissed';
            localStorage.setItem(DISMISS_PREFIX + c.origin, hash);
          } catch { /* ignore */ }
          node?.remove();
          if (this.querySelectorAll('[role=alert]').length === 0) {
            this.classList.add('hidden');
          }
        },
        accept: async () => {
          if (!armed) return;
          await api('POST', '/api/tls/accept', { origin: c.origin });
          await this.load();
        },
      };

      node = clone(this, 'change', {
        host,
        title: t(isUntrusted ? 'portal.tls.titleUntrusted' : 'portal.tls.titleChanged', { origin: c.origin }),
        text: isUntrusted
          ? t('portal.tls.textUntrusted', { now: nowIssuer, root: c.observedRoot, validTo: c.validTo ?? '-' })
          : t('portal.tls.text', { before: beforeIssuer, now: nowIssuer }),
        'before-issuer': beforeIssuer,
        'now-issuer': nowIssuer,
        'before-root': beforeRoot,
        'now-root': nowRoot,
        'before-valid': beforeValid,
        'now-valid': nowValid,
        'before-fp': beforeFp,
        'now-fp': nowFp,
      }, actions);

      const colNow = node.querySelector('[data-testid="tls-col-now"]');
      if (colNow) {
        if (beforeIssuer !== nowIssuer) colNow.querySelector('[data-field="now-issuer"]')?.classList.add('text-warning', 'font-semibold');
        if (beforeRoot !== nowRoot) colNow.querySelector('[data-field="now-root"]')?.classList.add('text-warning', 'font-semibold');
        if (beforeValid !== nowValid) colNow.querySelector('[data-field="now-valid"]')?.classList.add('text-warning', 'font-semibold');
        if (beforeFp !== nowFp) colNow.querySelector('[data-field="now-fp"]')?.classList.add('text-warning', 'font-semibold');
      }

      const acceptBtn = node.querySelector('[data-action="accept"]');
      setTimeout(() => {
        armed = true;
        if (acceptBtn) {
          acceptBtn.disabled = false;
          acceptBtn.classList.remove('btn-disabled', 'pointer-events-none');
        }
      }, 1500);

      this.appendChild(node);
    }
  },
});
