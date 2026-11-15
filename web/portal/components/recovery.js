// De herstelcode pas "bewaard" als de laatste 4 tekens kloppen (wie hem niet noteerde, merkt het hier).
import { $, on, define, refresh, setTab } from '../core/index.js';
import template from './recovery.html';

define('ks-recovery', { template, wire() {
  $('recovery-confirm').addEventListener('input', () => {
    const code = $('recovery-code').textContent.replace(/-/g, '');
    $('recovery-done').disabled = $('recovery-confirm').value.trim().toUpperCase() !== code.slice(-4);
  });
  on('recovery-done', async () => { $('recovery-code').textContent = ''; $('recovery-confirm').value = ''; $('recovery-done').disabled = true; setTab('passkeys'); await refresh(); });
} });
