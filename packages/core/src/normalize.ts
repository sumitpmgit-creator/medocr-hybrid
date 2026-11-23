// SPDX-License-Identifier: Apache-2.0
/** Clinical value normalisers ("permitted normalization" for field exact-match). Source values are never overwritten. */

const FREQ: Record<string, string> = {
  od: '1-0-0', qd: '1-0-0', 'once daily': '1-0-0', 'once a day': '1-0-0', daily: '1-0-0',
  bd: '1-0-1', bid: '1-0-1', 'twice daily': '1-0-1', 'twice a day': '1-0-1',
  tds: '1-1-1', tid: '1-1-1', 'thrice daily': '1-1-1', 'three times a day': '1-1-1',
  qid: '1-1-1-1', 'four times a day': '1-1-1-1',
  hs: '0-0-1', 'at night': '0-0-1', 'at bedtime': '0-0-1',
  sos: 'sos', prn: 'sos', 'as needed': 'sos', stat: 'stat',
};

export function normalizeFrequency(v?: string | null): string {
  if (!v) return '';
  const t = v.toLowerCase().replace(/[.\s]+/g, ' ').trim();
  const dashed = t.replace(/\s*[-–x×]\s*/g, '-');
  if (/^\d(?:\/\d)?(?:-\d(?:\/\d)?){2,3}$/.test(dashed)) return dashed;
  return FREQ[t] ?? FREQ[t.replace(/\s/g, '')] ?? t;
}

const UNIT: Record<string, string> = { mgs: 'mg', milligram: 'mg', milligrams: 'mg', mcg: 'mcg', 'µg': 'mcg', ug: 'mcg', ml: 'ml', iu: 'iu', g: 'g', gm: 'g', gms: 'g' };

export function normalizeStrength(v?: string | null): string {
  if (!v) return '';
  const t = v.toLowerCase().replace(/\s+/g, '');
  return t.replace(/([a-zµ]+)/g, (u) => UNIT[u] ?? u);
}

export function normalizeUnit(v?: string | null): string {
  if (!v) return '';
  return v.toLowerCase().replace(/\s+/g, '').replace(/μ/g, 'µ').replace(/^(mgs|milligrams?)$/, 'mg');
}

export function normalizeNumber(v?: string | null): string {
  if (!v) return '';
  const t = v.replace(/,/g, '').replace(/−/g, '-').trim();
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? String(n) : t.toLowerCase();
}

export function normalizeName(v?: string | null): string {
  if (!v) return '';
  return v.toLowerCase().replace(/^(tab|tablet|cap|capsule|syp|syrup|inj|injection)\.?\s+/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function normalizeGeneric(v?: string | null): string {
  return (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}
