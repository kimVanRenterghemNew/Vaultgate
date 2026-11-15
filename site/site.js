// Theme toggle: follows the OS until you choose; your choice is remembered on this device only. The page reads fine
// without this script: the CSS follows prefers-color-scheme by itself.
(() => {
  const root = document.documentElement;
  const KEY = 'vaultgate-theme';
  const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode: follow the OS */ }
  if (saved === 'dracula' || saved === 'console-light') root.dataset.theme = saved;
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.theme-toggle')) return;
    const current = root.dataset.theme || (dark() ? 'dracula' : 'console-light');
    const next = current === 'dracula' ? 'console-light' : 'dracula';
    root.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch (e) { /* not remembered, still switched */ }
  });
})();
