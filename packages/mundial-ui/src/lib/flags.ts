/**
 * FIFA 3-letter code → ISO 3166-1 alpha-2 (flagcdn). England and Scotland use
 * their GB subdivision codes. Used by <Flag /> and anything that needs a flag
 * image URL for a team code.
 */
export const FIFA_TO_ISO: Record<string, string> = {
  MEX: 'mx', RSA: 'za', KOR: 'kr', CZE: 'cz', CAN: 'ca', SUI: 'ch', QAT: 'qa', BIH: 'ba',
  BRA: 'br', MAR: 'ma', HAI: 'ht', SCO: 'gb-sct', USA: 'us', PAR: 'py', AUS: 'au', TUR: 'tr',
  GER: 'de', CUW: 'cw', CIV: 'ci', ECU: 'ec', NED: 'nl', JPN: 'jp', TUN: 'tn', SWE: 'se',
  BEL: 'be', EGY: 'eg', IRN: 'ir', NZL: 'nz', ESP: 'es', CPV: 'cv', KSA: 'sa', URU: 'uy',
  FRA: 'fr', SEN: 'sn', NOR: 'no', IRQ: 'iq', ARG: 'ar', ALG: 'dz', AUT: 'at', JOR: 'jo',
  POR: 'pt', UZB: 'uz', COL: 'co', COD: 'cd', ENG: 'gb-eng', CRO: 'hr', GHA: 'gh', PAN: 'pa'
};

/** Build a flagcdn URL for a FIFA team code. Returns '' if the code is unknown. */
export function flagUrl(code: string, width: 40 | 80 | 160 = 40): string {
  const iso = FIFA_TO_ISO[code];
  return iso ? `https://flagcdn.com/w${width}/${iso}.png` : '';
}
