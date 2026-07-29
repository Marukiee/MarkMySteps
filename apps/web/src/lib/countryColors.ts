/**
 * A colour per country, taken from its own flag.
 *
 * Generated from the flag files in public/flags: the most-used colour in each
 * one, ignoring white, black and near-greys, which are the colours every flag
 * shares and so tell you nothing. The globe adjusts saturation and lightness
 * per theme, so what this really carries is the hue.
 */
export const COUNTRY_COLOR: Record<string, string> = {
  AE: '#00732f', AF: '#bd6b00', AM: '#d90012', AO: '#ffec00', AQ: '#3a7dce', AR: '#85340a',
  AT: '#c8102e', AU: '#00008b', AZ: '#ed2939', BA: '#000099', BD: '#006a4e', BE: '#ffd90c',
  BF: '#de0000', BG: '#00966e', BI: '#18b637', BJ: '#319400', BN: '#f7e017', BO: '#e8a30e',
  BR: '#309e3a', BS: '#ffe900', BT: '#ffd520', BW: '#00cbff', BY: '#ce1720', BZ: '#730000',
  CA: '#d52b1e', CD: '#007fff', CF: '#ffff00', CG: '#00ca00', CI: '#00cd00', CL: '#0039a6',
  CM: '#fcd116', CN: '#ee1c25', CO: '#ffe800', CR: '#0000b4', CU: '#002a8f', CY: '#435125',
  CZ: '#d7141a', DE: '#ffcc00', DJ: '#00cc00', DK: '#c8102e', DO: '#002d62', DZ: '#006233',
  EC: '#005b00', EE: '#1791ff', EG: '#c09300', EH: '#c4111b', ER: '#be0027', ES: '#c8b100',
  ET: '#ffc621', FI: '#002f6c', FJ: '#00a651', FK: '#512007', FR: '#000091', FX: '#000091',
  GA: '#ffe700', GB: '#c8102e', GH: '#006b3f', GL: '#d00c33', GM: '#000099', GN: '#ffff00',
  GQ: '#73452b', GR: '#0d5eaf', GT: '#406325', GW: '#ce1126', GY: '#399408', HN: '#18c3df',
  HR: '#f7db17', HT: '#d20014', HU: '#388d00', ID: '#e70011', IE: '#009a49', IL: '#0038b8',
  IN: '#000088', IQ: '#ce1126', IR: '#da0000', IS: '#003897', IT: '#009246', JM: '#ffcc00',
  JO: '#009900', JP: '#bc002d', KE: '#006600', KG: '#ffff00', KH: '#032ea1', KP: '#3e5698',
  KR: '#cd2e3a', KW: '#f31830', KZ: '#ffec2d', LA: '#ce1126', LB: '#ee161f', LK: '#ffb700',
  LR: '#cc0000', LS: '#009543', LT: '#006a44', LU: '#ed2939', LV: '#981e32', LY: '#239e46',
  MA: '#c1272d', MD: '#ffff00', ME: '#d4af3a', MG: '#fc3d32', MK: '#d20000', ML: '#009a00',
  MM: '#fecb00', MN: '#da2032', MR: '#ffc400', MW: '#f31509', MX: '#aa8c30', MY: '#cc0000',
  MZ: '#ffca00', NA: '#3662a2', NC: '#009543', NE: '#e05206', NG: '#008753', NI: '#97c924',
  NL: '#ae1c28', NO: '#002664', NP: '#ce0000', NZ: '#cc142b', OM: '#ef0000', PA: '#db0000',
  PE: '#d91023', PG: '#ffcc00', PH: '#0038a8', PK: '#0c590b', PL: '#dc143c', PR: '#ed0000',
  PS: '#009639', PT: '#ffff00', PY: '#0038a8', QA: '#8d1b3d', RO: '#00319c', RS: '#edb92e',
  RU: '#0039a6', RW: '#00a1de', SA: '#165d31', SB: '#0000d6', SD: '#009a00', SE: '#005293',
  SI: '#0000bf', SK: '#ee1c25', SL: '#0000cd', SN: '#0b7226', SO: '#40a6ff', SR: '#377e3f',
  SS: '#078930', SU: '#0039a6', SV: '#00209f', SY: '#007a3d', SZ: '#ffd900', TD: '#002664',
  TF: '#002395', TG: '#118600', TH: '#2d2a4a', TJ: '#f8c300', TL: '#cb000f', TM: '#d22630',
  TN: '#e70013', TR: '#e30a17', TT: '#e00000', TW: '#000095', TZ: '#0099ff', UA: '#0057b8',
  UG: '#de3108', UK: '#c8102e', US: '#bd3d44', UY: '#0038a8', UZ: '#0099b5', VE: '#cf142b',
  VN: '#da251d', VU: '#fdce12', YE: '#f10600', YU: '#edb92e', ZA: '#000c8a', ZM: '#ef7d00',
  ZW: '#d40000',
};
