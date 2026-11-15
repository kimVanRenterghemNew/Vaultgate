// Een oudere kopie van de kluis is teruggezet (anti-rollback): de kluis opent pas als de gebruiker dat bewust aanvinkt.
// Eén waarschuwing voor de pagina, boven het inlog- en ontgrendelscherm; refresh() toont of verbergt ze.
import { $, define } from '../core/index.js';
import template from './rollback.html';

define('ks-rollback', { template });

/** Of de gebruiker bevestigt dat hij bewust een oudere kopie terugzet (dan stuurt ontgrendelen `acceptRollback`). */
export const rollbackAccepted = () => $('rollback-accept')?.checked === true;
