// De-identification leak check. Pure functions; covered by test/phi.test.ts.
//
// 1. extractPhi(): build the list of identifiers a document contains, from the ground truth.
//    Structured `phi: [{type, value}]` in the manifest wins; otherwise the rules below run on referenceText.
// 2. findLeaks(): an item "leaks" if its token sequence survives in a target text (de-id stage output,
//    or any request body sent to the cloud).
// Raw values never leave this module except inside the in-memory result; use maskValue() for anything persisted.
import { createHash } from 'node:crypto';

export type PhiType = 'patient_name' | 'clinician_name' | 'record_id' | 'phone' | 'dob' | 'national_id' | 'email';
export interface PhiItem { type: PhiType; value: string; rule: string }

const LABEL_VALUE = String.raw`\s*[:\-#]\s*([^\n]+)`;
const APOS = String.raw`(?:['’]s)?`;

/** Rules applied to the reference transcript, in order. Each is documented in README.md#de-id-leak-check. */
export const PHI_RULES: { type: PhiType; rule: string; re: RegExp; group?: number }[] = [
  { type: 'patient_name', rule: 'label:patient-name', re: new RegExp(String.raw`^\s*(?:patient${APOS}\s*name|name\s+of\s+patient|patient|name|pt\.?\s*name)${LABEL_VALUE}`, 'gim') },
  { type: 'clinician_name', rule: 'label:clinician', re: new RegExp(String.raw`^\s*(?:doctor${APOS}\s*name|consultant|physician|nurse${APOS}?\s*name|requested\s+by|prescribed\s+by|attending|ward\s+doctor)${LABEL_VALUE}`, 'gim') },
  { type: 'clinician_name', rule: 'title+capitalised-words', re: /\b(?:Dr|Mr|Mrs|Ms|Miss|Prof)\.?[ \t]+([A-Z][A-Za-z'’-]+(?:[ \t]+[A-Z][A-Za-z'’-]+){0,2})/g },
  { type: 'record_id', rule: 'label:record-id', re: new RegExp(String.raw`^\s*(?:hospital\s*(?:no\.?|number|num)|mrn|uhid|patient\s*id|ip\s*no\.?|op\s*no\.?|folder\s*(?:no\.?|number)|card\s*(?:no\.?|number)|reg(?:istration)?\.?\s*(?:no\.?|number)|lab\s*(?:no\.?|id)|sample\s*id)${LABEL_VALUE}`, 'gim') },
  { type: 'dob', rule: 'label:dob', re: new RegExp(String.raw`(?:\bdob\b|\bd\.o\.b\.?|date\s+of\s+birth)\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})`, 'gi') },
  { type: 'national_id', rule: 'pattern:aadhaar-abha', re: /\b(\d{4}[- ]\d{4}[- ]\d{4}|\d{2}-\d{4}-\d{4}-\d{4}|\d{12}|\d{14})\b/g },
  { type: 'phone', rule: 'pattern:phone(10-13 digits)', re: /(\+?\d[\d -]{8,15}\d)/g },
  { type: 'email', rule: 'pattern:email', re: /\b([\w.+-]+@[\w-]+\.[\w.-]+)\b/g },
];

/** Placeholder-ish values that are not identifiers. */
const EMPTY = /^(?:-+|n\/?a|nil|none|null|\[[^\]]*\]|_+|\.+)$/i;

export function tokens(s: string): string[] {
  return s.normalize('NFC').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').toLowerCase().replace(/[’']/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function cleanValue(type: PhiType, v: string): string {
  let s = v.trim().replace(/\s{2,}.*$/, '').replace(/[.,;]+$/, ''); // cut at column gaps (tables) and trailing punctuation
  if (type === 'patient_name' || type === 'clinician_name') s = s.replace(/^(?:Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s+/i, '');
  return s.trim();
}

export function extractPhi(ref: { referenceText?: string; phi?: { type: PhiType; value: string }[] }): PhiItem[] {
  if (ref.phi && ref.phi.length) return dedupe(ref.phi.map((p) => ({ ...p, rule: 'structured' })));
  const text = ref.referenceText ?? '';
  const out: PhiItem[] = [];
  for (const r of PHI_RULES) {
    for (const m of text.matchAll(r.re)) {
      const raw = m[r.group ?? 1];
      if (!raw) continue;
      const value = cleanValue(r.type, raw);
      if (!value || EMPTY.test(value) || tokens(value).length === 0) continue;
      if (r.type === 'phone' && value.replace(/\D/g, '').length < 10) continue;
      if (r.type === 'phone' && /^\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}$/.test(value)) continue;
      out.push({ type: r.type, value, rule: r.rule });
    }
  }
  return dedupe(out);
}

function dedupe(xs: PhiItem[]): PhiItem[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = tokens(x.value).join(' ');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** True if the item's token sequence appears contiguously in the target. */
export function survives(item: { value: string }, target: string): boolean {
  const v = tokens(item.value);
  if (v.length === 0) return false;
  const t = tokens(target);
  outer: for (let i = 0; i + v.length <= t.length; i++) {
    for (let j = 0; j < v.length; j++) if (t[i + j] !== v[j]) continue outer;
    return true;
  }
  return false;
}

/** Safe-to-persist form: type, rule, length mask, short hash (to tell repeats apart). Never any character of the value. */
export function maskValue(item: PhiItem): { type: PhiType; rule: string; masked: string; sha256_8: string } {
  const v = item.value;
  return { type: item.type, rule: item.rule, masked: '*'.repeat(v.length), sha256_8: createHash('sha256').update(v).digest('hex').slice(0, 8) };
}

export function findLeaks(items: PhiItem[], targets: string[]): PhiItem[] {
  const joined = targets.join('\n');
  return items.filter((it) => survives(it, joined));
}
