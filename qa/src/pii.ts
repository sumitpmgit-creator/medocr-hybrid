/**
 * Adversarial PII/PHI corpus (all values synthetic) and a leak scanner.
 *
 * Every case has a `text` (as OCR would emit it), the identifiers that must
 * never leave the device (`pii`), and clinical strings that must survive
 * de-identification (`keep`, utility check against over-redaction).
 */

export type PiiType = 'name' | 'phone' | 'aadhaar' | 'vid' | 'abha' | 'pan' | 'address' | 'pincode' | 'dob' | 'mrn' | 'email';

export interface PiiValue { type: PiiType; value: string }
export interface PiiCase { id: string; title: string; text: string; pii: PiiValue[]; keep: string[] }

export const PII_CASES: PiiCase[] = [
  // ---------- names ----------
  { id: 'N1', title: 'plain patient name', text: 'Patient Name: Rajesh Kumar\nHemoglobin 13.5 g/dL', pii: [{ type: 'name', value: 'Rajesh Kumar' }], keep: ['Hemoglobin', '13.5', 'g/dL'] },
  { id: 'N2', title: 'ALL CAPS name with honorific', text: 'PT: MRS. ANANYA IYER  AGE/SEX 34Y/F\nTSH 2.1 uIU/mL', pii: [{ type: 'name', value: 'ANANYA IYER' }], keep: ['TSH', '2.1', 'uIU/mL'] },
  { id: 'N3', title: 'lowercase name, no label', text: 'sunita devi w/o ramesh yadav\nTab. Metformin 500 mg 1-0-1', pii: [{ type: 'name', value: 'sunita devi' }, { type: 'name', value: 'ramesh yadav' }], keep: ['Metformin', '500 mg', '1-0-1'] },
  { id: 'N4', title: 'name split across lines', text: 'Name : Venkata\nSubramanian Iyer\nCreatinine 1.1 mg/dL', pii: [{ type: 'name', value: 'Venkata Subramanian Iyer' }], keep: ['Creatinine', '1.1'] },
  { id: 'N5', title: 'initials + surname, s/o relation', text: 'Mr. K. S. Reddy S/O Late Narasimha Reddy\nCap. Omeprazole 20mg OD', pii: [{ type: 'name', value: 'K. S. Reddy' }, { type: 'name', value: 'Narasimha Reddy' }], keep: ['Omeprazole', '20mg', 'OD'] },
  { id: 'N6', title: 'Devanagari name', text: 'रोगी: अनीता शर्मा\nBlood Sugar (F) 98 mg/dL', pii: [{ type: 'name', value: 'अनीता शर्मा' }], keep: ['Blood Sugar', '98'] },
  { id: 'N7', title: 'name with OCR noise (letter-spaced)', text: 'P a t i e n t : M O H D  I M R A N\nESR 12 mm/hr', pii: [{ type: 'name', value: 'MOHDIMRAN' }], keep: ['ESR', '12'] },
  // ---------- phones ----------
  { id: 'P1', title: 'phone +91 spaced', text: 'Mob: +91 98765 43210\nVitamin D 18 ng/mL', pii: [{ type: 'phone', value: '9876543210' }], keep: ['Vitamin D', '18'] },
  { id: 'P2', title: 'phone with leading 0 and hyphen', text: 'Contact 098765-43210', pii: [{ type: 'phone', value: '9876543210' }], keep: [] },
  { id: 'P3', title: 'phone in pairs', text: 'Ph 98 76 54 32 10 (home)', pii: [{ type: 'phone', value: '9876543210' }], keep: [] },
  { id: 'P4', title: 'landline with STD code', text: 'Tel: +91-80-2345-6789', pii: [{ type: 'phone', value: '8023456789' }], keep: [] },
  { id: 'P5', title: 'full-width digits', text: 'Mobile：９８７６５４３２１０', pii: [{ type: 'phone', value: '9876543210' }], keep: [] },
  { id: 'P6', title: 'Devanagari digits', text: 'फ़ोन ९८७६५४३२१०', pii: [{ type: 'phone', value: '9876543210' }], keep: [] },
  { id: 'P7', title: 'phone glued to text', text: 'Callon9876543210forreports', pii: [{ type: 'phone', value: '9876543210' }], keep: [] },
  // ---------- national IDs ----------
  { id: 'A1', title: 'Aadhaar spaced', text: 'Aadhaar No: 2345 6789 0123', pii: [{ type: 'aadhaar', value: '234567890123' }], keep: [] },
  { id: 'A2', title: 'Aadhaar hyphenated, no label', text: 'ID 2345-6789-0123 verified', pii: [{ type: 'aadhaar', value: '234567890123' }], keep: [] },
  { id: 'A3', title: 'Aadhaar contiguous with dots', text: 'UID:2345.6789.0123', pii: [{ type: 'aadhaar', value: '234567890123' }], keep: [] },
  { id: 'A4', title: 'Aadhaar VID 16 digits', text: 'VID 9123 4567 8901 2345', pii: [{ type: 'vid', value: '9123456789012345' }], keep: [] },
  { id: 'A5', title: 'ABHA number', text: 'ABHA: 91-1234-5678-9012', pii: [{ type: 'abha', value: '91123456789012' }], keep: [] },
  { id: 'A6', title: 'PAN', text: 'PAN abcpk1234f', pii: [{ type: 'pan', value: 'ABCPK1234F' }], keep: [] },
  // ---------- address ----------
  { id: 'AD1', title: 'multi-line Indian address', text: 'Addr: Flat 302, Shanti Apartments,\n14th Cross, Indiranagar,\nBengaluru - 560038', pii: [{ type: 'address', value: 'Shanti Apartments' }, { type: 'address', value: '14th Cross, Indiranagar' }, { type: 'pincode', value: '560038' }], keep: [] },
  { id: 'AD2', title: 'PIN with space', text: 'H.No 4-56/B, Gandhi Nagar, Hyderabad 500 080', pii: [{ type: 'address', value: '4-56/B, Gandhi Nagar' }, { type: 'pincode', value: '500080' }], keep: [] },
  // ---------- dates of birth ----------
  { id: 'D1', title: 'DOB dd/mm/yyyy', text: 'DOB: 14/03/1987', pii: [{ type: 'dob', value: '14/03/1987' }], keep: [] },
  { id: 'D2', title: 'D.O.B ISO', text: 'D.O.B 1987-03-14', pii: [{ type: 'dob', value: '1987-03-14' }], keep: [] },
  { id: 'D3', title: 'DOB in words', text: 'Born on 14th March 1987', pii: [{ type: 'dob', value: '14th March 1987' }], keep: [] },
  { id: 'D4', title: 'DOB short dotted', text: 'dob 14.03.87', pii: [{ type: 'dob', value: '14.03.87' }], keep: [] },
  // ---------- MRN / hospital ids ----------
  { id: 'M1', title: 'MRN plain', text: 'MRN: 00123456\nPlatelets 2,50,000 /cumm', pii: [{ type: 'mrn', value: '00123456' }], keep: ['Platelets', '2,50,000'] },
  { id: 'M2', title: 'UHID with site code', text: 'UHID-BLR-2024-000981', pii: [{ type: 'mrn', value: 'UHID-BLR-2024-000981' }], keep: [] },
  { id: 'M3', title: 'IP number with slash', text: 'IP No. 24/11873 Ward 3B', pii: [{ type: 'mrn', value: '24/11873' }], keep: [] },
  { id: 'M4', title: 'alphanumeric reg no', text: 'Reg#A1B2C3D4', pii: [{ type: 'mrn', value: 'A1B2C3D4' }], keep: [] },
  { id: 'M5', title: 'PID glued', text: 'PatientID:PID0045678', pii: [{ type: 'mrn', value: 'PID0045678' }], keep: [] },
  // ---------- email ----------
  { id: 'E1', title: 'email', text: 'Email rajesh.kumar87@gmail.com', pii: [{ type: 'email', value: 'rajesh.kumar87@gmail.com' }], keep: [] },
  { id: 'E2', title: 'obfuscated email', text: 'mail: rajesh.kumar87 [at] gmail [dot] com', pii: [{ type: 'email', value: 'rajesh.kumar87' }], keep: [] },
];

/** A realistic full prescription combining many identifiers. */
export const FULL_RX: PiiCase = {
  id: 'FULL',
  title: 'full prescription with every identifier type',
  text: [
    'CITY CARE CLINIC, Indiranagar',
    'Patient: Rajesh Kumar   Age/Sex: 38Y/M   DOB: 14/03/1987',
    'Mob: +91 98765 43210   Aadhaar: 2345 6789 0123   UHID-BLR-2024-000981',
    'Addr: Flat 302, Shanti Apartments, Bengaluru - 560038',
    'Rx',
    '1. Tab. Metformin 500 mg  1-0-1  x 30 days',
    '2. Tab. Telmisartan 40mg  OD  after food',
    'HbA1c 7.8 %',
  ].join('\n'),
  pii: [
    { type: 'name', value: 'Rajesh Kumar' }, { type: 'dob', value: '14/03/1987' }, { type: 'phone', value: '9876543210' },
    { type: 'aadhaar', value: '234567890123' }, { type: 'mrn', value: 'UHID-BLR-2024-000981' },
    { type: 'address', value: 'Shanti Apartments' }, { type: 'pincode', value: '560038' },
  ],
  keep: ['Metformin', '500 mg', '1-0-1', 'Telmisartan', '40mg', 'HbA1c', '7.8'],
};

export const ALL_PII: PiiValue[] = [...PII_CASES, FULL_RX].flatMap((c) => c.pii);

// ---------------------------------------------------------------------------
// Leak scanner
// ---------------------------------------------------------------------------

const DEVANAGARI_ZERO = 0x0966;
/** NFKC folds full-width digits; Devanagari digits are mapped by hand. */
export function foldDigits(s: string): string {
  return s.normalize('NFKC').replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO));
}

const alnum = (s: string) => foldDigits(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const digits = (s: string) => foldDigits(s).replace(/\D+/g, '');

/** Pull every string we can find out of a payload: raw, JSON strings, URL-decoded, base64-decoded. */
export function payloadViews(payload: string): string[] {
  const views = new Set<string>([payload]);
  try { views.add(decodeURIComponent(payload.replace(/\+/g, ' '))); } catch { /* ignore */ }
  try {
    const walk = (v: unknown): void => {
      if (typeof v === 'string') { views.add(v); return; }
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(JSON.parse(payload));
  } catch { /* not JSON */ }
  for (const v of [...views]) {
    for (const m of v.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
      try {
        const dec = Buffer.from(m, 'base64').toString('utf8');
        // keep only decodes that look like text
        if (/^[\p{L}\p{N}\p{P}\p{Zs}\n\r\t]+$/u.test(dec)) views.add(dec);
      } catch { /* ignore */ }
    }
  }
  return [...views];
}

export interface LeakFinding { type: PiiType; value: string; how: 'exact' | 'alnum' | 'digits' | 'name-token' }

/**
 * Returns every PII value from `pii` that appears in `payload` in any of these forms:
 *  - exact (case-insensitive) substring
 *  - alnum-folded (spaces, punctuation, full-width/Devanagari digits ignored)
 *  - digits-only, for numeric identifiers of >= 6 digits (phone, Aadhaar, VID, ABHA, PIN, MRN)
 *  - any name token of >= 4 letters (word-bounded), for names
 */
export function findLeaks(payload: string, pii: PiiValue[] = ALL_PII): LeakFinding[] {
  const views = payloadViews(payload);
  const findings: LeakFinding[] = [];
  const seen = new Set<string>();
  const add = (p: PiiValue, how: LeakFinding['how']) => {
    const k = `${p.type}:${p.value}`;
    if (!seen.has(k)) { seen.add(k); findings.push({ ...p, how }); }
  };
  for (const view of views) {
    const lower = foldDigits(view).toLowerCase();
    const a = alnum(view);
    const d = digits(view);
    for (const p of pii) {
      const v = foldDigits(p.value).toLowerCase();
      if (lower.includes(v)) { add(p, 'exact'); continue; }
      const av = alnum(p.value);
      if (av.length >= 6 && a.includes(av)) { add(p, 'alnum'); continue; }
      const dv = digits(p.value);
      if (p.type !== 'name' && p.type !== 'address' && p.type !== 'email' && dv.length >= 6 && d.includes(dv)) { add(p, 'digits'); continue; }
      if (p.type === 'name') {
        const tokens = p.value.split(/[\s.]+/u).filter((t) => t.length >= 4);
        if (tokens.some((t) => new RegExp(`(^|[^\\p{L}])${t.toLowerCase()}($|[^\\p{L}])`, 'u').test(lower))) add(p, 'name-token');
      }
    }
  }
  return findings;
}
