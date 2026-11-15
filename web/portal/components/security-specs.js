// De link naar de technische securityspecificatie op de website (sleutelhiërarchie, Argon2id-parameters, libsodium):
// in de browser, niet in het portaalvenster. Eén component, in het welkom (stap 4) en in Settings.
import { define } from '../core/index.js';
import template from './security-specs.html';

define('ks-security-specs', { template });
