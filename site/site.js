// Theme toggle: follows the OS until you choose; your choice is remembered on this device only.
(() => {
  const root = document.documentElement;
  const KEY = 'vaultgate-theme';
  const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  const apply = (theme) => { root.dataset.theme = theme; };
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* private mode: follow the OS */ }
  apply(saved || (prefersDark() ? 'dracula' : 'harborlight'));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.theme-toggle')) return;
    const next = root.dataset.theme === 'dracula' ? 'harborlight' : 'dracula';
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* not remembered, still switched */ }
  });
})();
