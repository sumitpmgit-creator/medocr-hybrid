// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic de-identification safety net, run on-device AFTER Nano's own redaction and
 * BEFORE anything is sent to the cloud. Regex is conservative by design: it may over-redact.
 * Not a guarantee of anonymisation; names in free text can slip through (documented risk).
 */
export type PhiType = 'aadhaar' | 'abha_number' | 'abha_address' | 'phone' | 'email' | 'name' | 'reg_no' | 'uhid';

export interface DeidResult { text: string; redactions: Partial<Record<PhiType, number>>; total: number }

const RULES: { type: PhiType; re: RegExp; replace?: (m: string, ...g: string[]) => string }[] = [
  // ABHA number: 14 digits, often 2-4-4-4
  { type: 'abha_number', re: /\b\d{2}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g },
  // Aadhaar: 12 digits, often 4-4-4 (run after ABHA so 14-digit numbers are not split)
  { type: 'aadhaar', re: /\b\d{4}[- ]\d{4}[- ]\d{4}\b|\b\d{12}\b/g },
  { type: 'abha_address', re: /\b[\w.]+@(?:abdm|sbx)\b/gi },
  { type: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  // Indian mobile numbers with optional +91 / 0 prefix
  { type: 'phone', re: /(?:\+91[- ]?|\b0)?\b[6-9]\d{4}[- ]?\d{5}\b/g },
  { type: 'reg_no', re: /\b(Reg(?:istration)?\.?\s*(?:No\.?|Number)?\s*[:#]?\s*)([A-Z0-9/-]{3,})/gi, replace: (_m, p) => `${p}[REG_NO]` },
  { type: 'uhid', re: /\b((?:UHID|MRN|Patient\s*ID|IP\s*No|OP\s*No)\.?\s*[:#]?\s*)([A-Z0-9/-]{3,})/gi, replace: (_m, p) => `${p}[ID]` },
  // Labelled names: "Name: Ravi Kumar", "Patient: ...", "Mr. Ravi Kumar", "Dr. ..."
  { type: 'name', re: /\b((?:Patient(?:'s)?\s*Name|Name|Patient|Pt\.?)\s*[:\-]\s*)((?:[A-Z][a-zA-Z.']*\s?){1,4})/g, replace: (_m, p) => `${p}[NAME] ` },
  { type: 'name', re: /\b((?:Mr|Mrs|Ms|Miss|Master|Smt|Shri|Dr)\.?\s+)((?:[A-Z][a-zA-Z']+\s?){1,3})/g, replace: (_m, p) => `${p}[NAME] ` },
];

export function deidentify(input: string): DeidResult {
  let text = input;
  const redactions: Partial<Record<PhiType, number>> = {};
  for (const r of RULES) {
    text = text.replace(r.re, (...args: unknown[]) => {
      redactions[r.type] = (redactions[r.type] ?? 0) + 1;
      const m = args[0] as string;
      const groups = args.slice(1, -2) as string[];
      return r.replace ? r.replace(m, ...groups) : `[${r.type.toUpperCase()}]`;
    });
  }
  text = text.replace(/ +\n/g, '\n').replace(/ {2,}/g, ' ');
  const total = Object.values(redactions).reduce((a, b) => a + (b ?? 0), 0);
  return { text, redactions, total };
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
