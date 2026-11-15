// De portaal-UI in de browser (ingang voor esbuild -> portal.generated.js, inline onder de CSP-nonce geserveerd).
import { $, guarded, refresh, translate } from './core/index.js';
import { refreshMcp } from './components/index.js';

translate(document.body);
// Het eigen venster (Edge app-modus) heeft display-mode standalone; een gewone browsertab niet.
$('window-warning').classList.toggle('hidden', matchMedia('(display-mode: standalone)').matches);
guarded(refresh);
// Na een update van vaultgate: de MCP-installaties bijwerken (alleen bij een versiewissel), één keer per pagina.
let mcpChecked = false;
document.addEventListener('vault-state', ({ detail }) => {
  if (detail.kind !== 'open' || mcpChecked) return;
  mcpChecked = true;
  refreshMcp({ auto: true }).catch(() => {}); // niet via guarded: dat wist de melding bovenaan; een mislukte poging is niet erg, de knop Bijwerken blijft
});
