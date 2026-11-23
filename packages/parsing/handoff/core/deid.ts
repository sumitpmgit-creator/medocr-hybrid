// SPDX-License-Identifier: Apache-2.0
/**
 * Deterministic de-identification safety net, run on-device AFTER Nano's own
 * redaction and BEFORE anything is sent to the cloud. Drop-in replacement
 * for the original regex-only module: same exports (`deidentify`, `utf8Bytes`,
 * `PhiType`, `DeidResult`) and placeholders, plus `spans`, address/PIN/DOB/DATE
 * /PAN/VID types, and `assertSafeForCloud`.
 *
 * Dates of birth are replaced with [DOB]; every other calendar date with [DATE].
 * An age in years printed on the document may stay. `assertSafeForCloud` blocks
 * any residual date or DOB. Not a guarantee of anonymisation; unlabelled names
 * outside the seed list can slip through.
 *
 * This file is self-contained and can be copied to packages/core/src/deid.ts.
 */

export type PhiType =
  | 'aadhaar'
  | 'abha_number'
  | 'abha_address'
  | 'phone'
  | 'email'
  | 'name'
  | 'reg_no'
  | 'uhid'
  | 'address'
  | 'pin'
  | 'dob'
  | 'date'
  | 'pan'
  | 'vid';


export interface PhiSpan {
  type: PhiType;
  /** Inclusive start offset in the original (pre-redaction) string. */
  start: number;
  /** Exclusive end offset in the original (pre-redaction) string. */
  end: number;
}


export interface DeidResult {
  text: string;
  /** Count of redactions per type, matching core's return shape. */
  redactions: Partial<Record<PhiType, number>>;
  total: number;
  /** Offsets into the original input, before placeholders and whitespace collapse. */
  spans?: PhiSpan[];
}



/**
 * Placeholders emitted in `text`. Core's tokens are kept exactly:
 * [AADHAAR], [ABHA_NUMBER], [ABHA_ADDRESS], [PHONE], [EMAIL], [NAME],
 * [REG_NO], and [ID] (for UHID/MRN — not [UHID]).
 * Additions: [ADDRESS], [PIN], [DOB], [DATE], [PAN], [VID].
 */
export const PLACEHOLDERS: Record<PhiType, string> = {
  aadhaar: "[AADHAAR]",
  abha_number: "[ABHA_NUMBER]",
  abha_address: "[ABHA_ADDRESS]",
  phone: "[PHONE]",
  email: "[EMAIL]",
  name: "[NAME]",
  reg_no: "[REG_NO]",
  uhid: "[ID]",
  address: "[ADDRESS]",
  pin: "[PIN]",
  dob: "[DOB]",
  date: "[DATE]",
  pan: "[PAN]",
  vid: "[VID]",
};

const PLACEHOLDER_VALUES = new Set(Object.values(PLACEHOLDERS));

const PLACEHOLDER_TOKEN =
  /\[(?:NAME|ABHA_NUMBER|ABHA_ADDRESS|ABHA|PHONE|ADDRESS|REG_NO|EMAIL|AADHAAR|UHID|ID|PIN|DOB|DATE|PAN|VID)\]/g;

/** Words that end a person-name capture. */
const NAME_STOP_WORDS = new Set(
  [
    "age",
    "sex",
    "gender",
    "dob",
    "d.o.b",
    "d.o.b.",
    "date",
    "dated",
    "phone",
    "ph",
    "ph.",
    "mob",
    "mob.",
    "mobile",
    "tel",
    "tel.",
    "telephone",
    "email",
    "e-mail",
    "abha",
    "aadhaar",
    "aadhar",
    "address",
    "addr",
    "pin",
    "pincode",
    "uhid",
    "mrn",
    "reg",
    "reg.",
    "registration",
    "male",
    "female",
    "m",
    "f",
    "yrs",
    "yr",
    "years",
    "year",
    "y",
    "mbbs",
    "md",
    "ms",
    "dm",
    "dnb",
    "frcs",
    "frcp",
    "bds",
    "mds",
    "bams",
    "bhms",
    "ip",
    "op",
  ].map((s) => s.toLowerCase()),
);

/**
 * Bare "Name:" is skipped when the same line looks like a medicine line, so
 * "Name: Amoxicillin 500 mg" is not treated as a patient.
 */
const CLINICAL_AFTER_NAME =
  /\d+\s*(?:mg|mcg|ug|µg|g|gm|ml|iu|i\.u\.|units?|%|meq|mmol|mcg|tab|cap|syp)|(?:\b(?:tab|cap|syp|syrup|inj|injection|tablet|capsule|drops?|suspension|ointment|cream)\b)/i;

/** Organisation / manufacturer suffixes after "Dr. …" (do not redact). */
const ORG_SUFFIX =
  /^(?:['’]s)?\s+(?:laborator(?:y|ies)|labs?|ltd\.?|pvt\.?|private|limited|pharma\b|pharmaceuticals?|hospital|clinic|nursing|medical\s+(?:college|centre|center|institute)|diagnostic|healthcare|health\s*care)\b/i;

const ADDRESS_KEYWORDS =
  /\b(?:street|st\.|road|rd\.|marg|nagar|lane|cross|block|sector|phase|flat|apartment|apartments|apt\.?|house\s*no\.?|h\.?\s*no\.?|door\s*no\.?|plot\s*no\.?|villa|colony|layout|enclave|extension|society|village|vill\.|p\.?\s*o\.?|post\s*office|tehsil|taluk|taluka|district|dist\.|opp\.|opposite|near|behind|chowk|ganj|bhavan|niwas|floor|wing|premises|township|pg\b|residency|apartment|appt)\b/i;

/** Used only together with a 6-digit PIN, never as a standalone redaction. */
const CITY_NAMES = new Set(
  [
    "delhi",
    "new delhi",
    "mumbai",
    "bombay",
    "kolkata",
    "calcutta",
    "chennai",
    "madras",
    "bengaluru",
    "bangalore",
    "hyderabad",
    "pune",
    "ahmedabad",
    "jaipur",
    "lucknow",
    "surat",
    "kochi",
    "cochin",
    "nagpur",
    "indore",
    "bhopal",
    "patna",
    "bhubaneswar",
    "chandigarh",
    "gurgaon",
    "gurugram",
    "noida",
    "ghaziabad",
    "thane",
    "navi mumbai",
    "visakhapatnam",
    "vijayawada",
    "coimbatore",
    "madurai",
    "vadodara",
    "rajkot",
    "nashik",
    "kanpur",
    "ranchi",
    "guwahati",
    "trivandrum",
    "thiruvananthapuram",
    "mysore",
    "mysuru",
    "varanasi",
    "allahabad",
    "prayagraj",
    "amritsar",
    "ludhiana",
    "jodhpur",
    "raipur",
    "dehradun",
    "shimla",
    "panaji",
    "goa",
    "srinagar",
    "jammu",
    "pondicherry",
    "puducherry",
    "faridabad",
    "howrah",
    "secunderabad",
    "warangal",
    "tirupati",
    "mangalore",
    "mangaluru",
    "hubli",
    "belgaum",
    "aurangabad",
    "solapur",
    "kolhapur",
    "agra",
    "meerut",
  ].map((s) => s.toLowerCase()),
);

const LINE_START_CLINICAL =
  /^(?:tab(?:let)?|cap(?:sule)?|syp|syrup|inj(?:ection)?|rx|dose|frequency|duration|investigation|hemoglobin|haemoglobin|wbc|rbc|platelet|hba1c|creatinine|glucose|tsh|fbs|ppbs|rbs|urea|bilirubin|cholesterol|triglyceride|sgot|sgpt|alt|ast|sodium|potassium|chloride)\b/i;

/** Next-line labels that end a multi-line address. */
const NEW_SECTION_LABEL =
  /^(?:age|sex|gender|dob|d\.o\.b|date|dated|phone|ph\.?|mob(?:ile)?|tel(?:ephone)?|email|e-mail|abha|aadhaar|aadhar|patient|pt\.?|doctor|dr\.?|rx|diagnosis|advice|history|chief|investigation|test|uhid|mrn|reg(?:istration)?|ref(?:erred)?|weight|height|bp|pulse|temp)\b/i;

interface FoldedView {
  view: string;
  /** view[i] came from original[toOrig[i] .. toOrigEnd[i]). */
  toOrig: number[];
  toOrigEnd: number[];
}

/** NFKC + Devanagari/Bengali digits to ASCII. */
function foldChar(ch: string): string {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return ch;
  if (cp >= 0x0966 && cp <= 0x096f) return String(cp - 0x0966);
  if (cp >= 0x09e6 && cp <= 0x09ef) return String(cp - 0x09e6);
  return ch.normalize("NFKC");
}

/** Spaces between single Latin letters in a run of 3+ letters (OCR "M O H D"). */
function skippableLetterSpaces(text: string): Set<number> {
  const skip = new Set<number>();
  const re = /(?:^|[^A-Za-z])((?:[A-Za-z][ \t]+){2,}[A-Za-z])/g;
  for (const m of text.matchAll(re)) {
    const run = m[1];
    if (run === undefined || m.index === undefined) continue;
    const runStart = m.index + m[0].length - run.length;
    for (let i = 0; i < run.length; i++) {
      if (/[ \t]/.test(run.charAt(i))) skip.add(runStart + i);
    }
  }
  return skip;
}

function preprocess(text: string): FoldedView {
  const skip = skippableLetterSpaces(text);
  let view = "";
  const toOrig: number[] = [];
  const toOrigEnd: number[] = [];
  for (let i = 0; i < text.length; ) {
    if (skip.has(i)) {
      i += 1;
      continue;
    }
    const cp = text.codePointAt(i);
    if (cp === undefined) break;
    const len = cp > 0xffff ? 2 : 1;
    const out = foldChar(text.slice(i, i + len));
    for (let j = 0; j < out.length; j++) {
      view += out.charAt(j);
      toOrig.push(i);
      toOrigEnd.push(i + len);
    }
    i += len;
  }
  return { view, toOrig, toOrigEnd };
}

function mapSpanToOrig(
  start: number,
  end: number,
  toOrig: number[],
  toOrigEnd: number[],
): { start: number; end: number } | null {
  if (end <= start) return null;
  const s = toOrig[start];
  const e = toOrigEnd[end - 1];
  if (s === undefined || e === undefined || e <= s) return null;
  return { start: s, end: e };
}

const INDIAN_GIVEN_NAMES: ReadonlySet<string> = new Set([
    "aamir", "aarti", "aditi", "ajay", "amit", "ananya", "anil", "anita",
    "anjali", "arti", "arun", "aruna", "asha", "ashok", "bhavna", "chitra",
    "deepa", "deepak", "dinesh", "divya", "farhan", "farida", "fatima", "gaurav",
    "geeta", "girish", "gita", "harish", "harsh", "imran", "iqbal", "irfan",
    "isha", "jamal", "javed", "jaya", "kalpana", "kamala", "kavita", "kavya",
    "kiran", "lakshmi", "lalit", "lalita", "lata", "leela", "madhavi", "madhu",
    "mahesh", "mallika", "manisha", "manoj", "meena", "meera", "mehul", "mohammed",
    "mohan", "mohd", "mohini", "muhammad", "mukesh", "nandan", "nandini", "narasimha",
    "naresh", "naseem", "nasir", "neelam", "neha", "nirmala", "nisha", "omkar",
    "pankaj", "parveen", "pawan", "pooja", "poonam", "pradeep", "prakash", "pramod",
    "praveen", "preeti", "prema", "priya", "priyanka", "radha", "radhika", "rahul",
    "rajan", "rajani", "rajesh", "raju", "rakesh", "ramesh", "rani", "rashmi",
    "ravi", "reema", "rekha", "renuka", "ritu", "riya", "rohit", "roshan",
    "sachin", "sadhana", "sagar", "sakshi", "saleem", "salma", "salman", "sameer",
    "samir", "sandeep", "sangeeta", "sanjay", "santosh", "sapna", "sarita", "satish",
    "savita", "seema", "shabana", "shahid", "shalini", "shamim", "shankar", "sharad",
    "sharif", "sheela", "shilpa", "shobha", "shravan", "shruti", "shweta", "siddharth",
    "simran", "sita", "sneha", "sohail", "sonal", "srinivas", "subhash", "subramanian",
    "sucheta", "sudha", "sudhir", "sujata", "suman", "sumitra", "sunanda", "sunil",
    "sunita", "suraj", "suresh", "surinder", "sushma", "swati", "tanveer", "tanvi",
    "tarun", "tejinder", "uma", "umesh", "urmil", "usha", "varun", "veena",
    "venkata", "vidya", "vijay", "vijaya", "vikas", "vikram", "vinay", "vinod",
    "virender", "vishal", "waheeda", "yash", "yasmin", "zahir", "zainab", "zoya",
]);

const INDIAN_SURNAMES: ReadonlySet<string> = new Set([
    "agarwal", "agrawal", "ahmad", "ahmed", "ali", "ansari", "arora", "baig",
    "banerjee", "bansal", "begum", "bhat", "bhatt", "bibi", "burman", "chakraborty",
    "chand", "chatterjee", "chauhan", "chopra", "choudhary", "dar", "das", "desai",
    "devi", "dutt", "dutta", "gandhi", "ghosh", "goswami", "gowda", "goyal",
    "gujral", "gupta", "hegde", "hussain", "iyengar", "iyer", "jain", "johar",
    "joshi", "kapoor", "kashyap", "kaul", "kaur", "khan", "khanna", "kohli",
    "kumar", "kurup", "lal", "lamba", "lone", "malhotra", "malik", "mehta",
    "menon", "mirza", "mishra", "mittal", "mukherjee", "naidu", "naik", "nair",
    "nanda", "narasimha", "nawaz", "oberoi", "pande", "pandey", "parikh", "patel",
    "pathan", "pillai", "prasad", "puri", "qureshi", "rana", "rao", "rather",
    "rathore", "rawat", "reddy", "sabharwal", "sarabhai", "saxena", "sen", "seth",
    "shah", "sharma", "sheikh", "shetty", "shukla", "singh", "sinha", "srivastava",
    "subramanian", "syed", "talwar", "thakur", "tilak", "tiwari", "trivedi", "tyagi",
    "varma", "venkata", "verma", "vohra", "walia", "yadav",
]);

const INDIAN_NAME_TOKENS: ReadonlySet<string> = new Set([
  ...INDIAN_GIVEN_NAMES,
  ...INDIAN_SURNAMES,
]);

function isNameToken(word: string): boolean {
  const w = word.toLowerCase().replace(/\./g, "");
  return w.length >= 3 && INDIAN_NAME_TOKENS.has(w);
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function trimSpan(text: string, start: number, end: number): { start: number; end: number } | null {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(text.charAt(a))) a += 1;
  while (b > a && /\s/.test(text.charAt(b - 1))) b -= 1;
  if (a >= b) return null;
  const value = text.slice(a, b);
  if (PLACEHOLDER_VALUES.has(value)) return null;
  return { start: a, end: b };
}

function add(out: PhiSpan[], type: PhiType, text: string, start: number, end: number): void {
  const span = trimSpan(text, start, end);
  if (!span) return;
  out.push({ type, start: span.start, end: span.end });
}

function isPlaceholderAt(text: string, index: number): boolean {
  PLACEHOLDER_TOKEN.lastIndex = 0;
  for (const m of text.matchAll(PLACEHOLDER_TOKEN)) {
    if (m.index === undefined) continue;
    if (index >= m.index && index < m.index + m[0].length) return true;
  }
  return false;
}

/** Group-2 labelled match: (label)(value). */
function labelled(text: string, re: RegExp, type: PhiType, out: PhiSpan[]): void {
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const rx = new RegExp(re.source, flags);
  for (const m of text.matchAll(rx)) {
    if (m.index === undefined) continue;
    if (isPlaceholderAt(text, m.index)) continue;
    const label = m[1] ?? "";
    const value = m[2];
    if (value === undefined) {
      add(out, type, text, m.index, m.index + m[0].length);
      continue;
    }
    const valueStart = m.index + label.length;
    add(out, type, text, valueStart, valueStart + value.length);
  }
}

function findAbha(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  // Core: 14-digit ABHA, separators optional (2-4-4-4 or 14 contiguous).
  labelled(
    text,
    /\b(\d{2}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4})\b/g,
    "abha_number",
    out,
  );
  labelled(
    text,
    /\b(ABHA(?:\s*(?:No\.?|Number|ID|Id))?\s*[:.#=-]?\s*)(\d{2}(?:[- ]?\d{4}){3}|\d{14})\b/gi,
    "abha_number",
    out,
  );
  // ABHA address: name@abdm / name@sbx (optional trailing domain; core is @abdm/@sbx only).
  labelled(
    text,
    /\b([A-Za-z0-9._%+-]+@(?:abdm|sbx)(?:\.[A-Za-z]{2,})?)\b/gi,
    "abha_address",
    out,
  );
  labelled(
    text,
    /\b((?:ABHA\s*Address|ABHA\s*ID)\s*[:.#=-]?\s*)([A-Za-z0-9._%+-]+@(?:abdm|sbx)(?:\.[A-Za-z]{2,})?)\b/gi,
    "abha_address",
    out,
  );
  return out;
}

function findAadhaar(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  // Grouped 4-4-4 (run after ABHA so a 2-4-4-4 number is not split).
  labelled(text, /\b(\d{4}[-. ]\d{4}[-. ]\d{4})\b/g, "aadhaar", out);
  // Core also treats any word-bounded 12-digit run as Aadhaar. Overlaps with
  // 14-digit ABHA are dropped in resolveOverlaps (ABHA starts earlier).
  labelled(text, /\b(\d{12})\b/g, "aadhaar", out);
  labelled(
    text,
    /\b((?:Aadhaar|Aadhar|UIDAI|UID)\s*(?:No\.?|Number|ID)?\s*[:.#=-]?\s*)(\d{4}(?:[-. ]?\d{4}){2}|\d{12})\b/gi,
    "aadhaar",
    out,
  );
  return out;
}

function findEmails(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  const re = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    if (isPlaceholderAt(text, m.index)) continue;
    const addr = m[0].toLowerCase();
    if (/@(?:abdm|sbx)(?:\.|$)/.test(addr)) continue; // classified as ABHA
    add(out, "email", text, m.index, m.index + m[0].length);
  }
  const obf =
    /[A-Za-z0-9._%+-]+\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+)\s*[A-Za-z0-9.-]+\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+)\s*[A-Za-z]{2,}/gi;
  for (const m of text.matchAll(obf)) {
    if (m.index === undefined) continue;
    add(out, "email", text, m.index, m.index + m[0].length);
  }
  return out;
}

function isIndianMobile(d: string): boolean {
  if (d.startsWith("91") && d.length === 12) return /^91[6-9]\d{9}$/.test(d);
  if (d.startsWith("091") && d.length === 13) return /^091[6-9]\d{9}$/.test(d);
  if (d.startsWith("0") && d.length === 11) return /^0[6-9]\d{9}$/.test(d);
  if (d.length === 10) return /^[6-9]\d{9}$/.test(d);
  return false;
}

function isIndianLandline(d: string): boolean {
  if (isIndianMobile(d)) return false;
  // 0 + STD (2–4) + subscriber, typically 10–11 digits total.
  return /^0[1-5]\d{8,9}$/.test(d) || /^0(?:11|22|33|44|20|40|80|79)\d{7,8}$/.test(d);
}

function findPhones(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  const notDigitBefore = (i: number) => i <= 0 || !/\d/.test(text.charAt(i - 1));
  const notDigitAfter = (i: number) => i >= text.length || !/\d/.test(text.charAt(i));
  const patterns: RegExp[] = [
    // +91 / 0 / bare 10-digit starting 6-9, separators optional; no leading word-boundary so glued text matches.
    /(?:\+?91[\s\-.]*)?(?:0[\s\-.]*)?[6-9](?:[\s\-.]*\d){9}/g,
    // Digit pairs: 98 76 54 32 10
    /[6-9]\d(?:[\s\-]\d{2}){4}/g,
    // STD landlines, e.g. +91-80-2345-6789
    /(?:\+?91[\s\-.]*)?0?(?:11|22|33|44|20|40|80|79)[\s\-.]\d{3,5}[\s\-.]\d{3,5}/g,
    /\b0\d{2,4}[\s-]\d{3,5}[\s-]?\d{3,5}\b/g,
  ];
  for (const re of patterns) {
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(rx)) {
      if (m.index === undefined) continue;
      if (isPlaceholderAt(text, m.index)) continue;
      if (!notDigitBefore(m.index) || !notDigitAfter(m.index + m[0].length)) continue;
      const d = digitsOnly(m[0]);
      const ok =
        isIndianMobile(d) ||
        isIndianLandline(d) ||
        (d.startsWith("91") && d.length === 12 && isIndianMobile(d)) ||
        (d.startsWith("0") && (d.length === 10 || d.length === 11));
      if (!ok) continue;
      add(out, "phone", text, m.index, m.index + m[0].length);
    }
  }
  const labelledRe =
    /(?:(?:ph(?:one)?|tel(?:e(?:phone)?)?|mob(?:ile)?|contact|landline|std|cell|whatsapp|फोन|मोबाइल|दूरभाष|सम्पर्क|ফোন|মোবাইল)\.?\s*(?:no\.?|number|#)?\s*[:.#=-]?\s*)((?:\+?91[\s-]*)?0?\d[\d\s\-.]{7,16}\d)/gi;
  for (const m of text.matchAll(labelledRe)) {
    if (m.index === undefined || m[1] === undefined) continue;
    const valueStart = m.index + m[0].length - m[1].length;
    const d = digitsOnly(m[1]);
    if (isIndianMobile(d) || isIndianLandline(d) || (d.startsWith("0") && d.length >= 10 && d.length <= 11) || (d.length === 10 && /^[6-9]/.test(d))) {
      add(out, "phone", text, valueStart, valueStart + m[1].length);
    }
  }
  return out;
}

function findRegNos(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  labelled(
    text,
    /\b(Reg(?:istration|n)?\.?\s*(?:No\.?|Number|#)?\s*[:.#=-]?\s*)([A-Z]{0,6}[\/-]?\d{3,10}(?:[\/-]\d{2,8})?)/gi,
    "reg_no",
    out,
  );
  labelled(
    text,
    /\b((?:MCI|NMC)\s*[:.#=\/-]?\s*)([A-Z0-9]{3,14})/gi,
    "reg_no",
    out,
  );
  labelled(
    text,
    /\b((?:[A-Z]{2,5}MC)\s*[:.#=\/-]?\s*)(\d{3,10}(?:[\/-]\d{2,8})?)/g,
    "reg_no",
    out,
  );
  labelled(
    text,
    /\b(Reg(?:istration|n)?\s*#\s*)([A-Z0-9][A-Z0-9\/-]{3,20})/gi,
    "reg_no",
    out,
  );
  return out;
}

function findUhids(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  labelled(
    text,
    /\b((?:UHID|MRN|Patient\s*I[Dd]|PatientID|PID|Hospital\s*number|Hosp(?:ital)?\s*(?:No\.?|ID|ID)|IP\s*No\.?|OP\s*No\.?|CR\s*No\.?)\s*[:.#=-]?\s*)([A-Z0-9][A-Z0-9\/-]{2,24})/gi,
    "uhid",
    out,
  );
  return out;
}

function lineBounds(text: string, index: number): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  let lineEnd = text.indexOf("\n", index);
  if (lineEnd === -1) lineEnd = text.length;
  return { lineStart, lineEnd, line: text.slice(lineStart, lineEnd) };
}

function extendAddressEnd(text: string, end: number): number {
  let cursor = end;
  let extra = 0;
  while (extra < 3) {
    if (cursor >= text.length || text.charAt(cursor) !== "\n") break;
    const nextStart = cursor + 1;
    let nextEnd = text.indexOf("\n", nextStart);
    if (nextEnd === -1) nextEnd = text.length;
    const next = text.slice(nextStart, nextEnd).trim();
    if (!next) break;
    if (NEW_SECTION_LABEL.test(next) || LINE_START_CLINICAL.test(next)) break;
    // Leave labelled PIN lines to the pin finder so they stay a typed [PIN].
    if (/^(?:PIN\s*Code|Pin\s*Code|Pincode|PIN|पिन(?:\s*कोड)?|পিন(?:\s*কোড)?)\b/i.test(next)) break;
    const hasPin = /(?:\bpin(?:\s*code)?|pincode)\b|\b[1-9]\d{5}\b/i.test(next);
    const hasKw = ADDRESS_KEYWORDS.test(next) || lineHasCityPin(next);
    if (!hasPin && !hasKw) break;
    cursor = nextEnd;
    extra += 1;
  }
  return cursor;
}

function lineHasCityPin(line: string): boolean {
  // "Mumbai - 400053" / "New Delhi, 110016". Do not match "150000-450000".
  const re = /([A-Za-z][A-Za-z. ]{2,40}?)(?:\s*[,:-]\s*|\s+)([1-9]\d{2}\s?\d{3})\b/g;
  for (const m of line.matchAll(re)) {
    const city = (m[1] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!m[0]) continue;
    // If the character immediately before the match is a digit, this is a numeric range.
    const idx = m.index ?? 0;
    const before = idx > 0 ? line.charAt(idx - 1) : "";
    if (/\d/.test(before)) continue;
    if (CITY_NAMES.has(city)) return true;
    // Trailing city token, e.g. "West Mumbai - 400053"
    const parts = city.split(" ");
    const last = parts.slice(-2).join(" ");
    const lastOne = parts[parts.length - 1] ?? "";
    if (CITY_NAMES.has(last) || CITY_NAMES.has(lastOne)) return true;
  }
  return false;
}

function findAddresses(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  // Labelled addresses, including Hindi/Bangla.
  const labelRe =
    /((?:^|\n)\s*(?:address|addr\.?|residential\s+address|correspondence\s+address|residing\s+at|r\/o|पता|ঠিকানা)\s*[:.#=-]\s*)([^\n]+)/gi;
  for (const m of text.matchAll(labelRe)) {
    if (m.index === undefined || m[1] === undefined || m[2] === undefined) continue;
    const valueStart = m.index + m[1].length;
    let valueEnd = valueStart + m[2].length;
    valueEnd = extendAddressEnd(text, valueEnd);
    add(out, "address", text, valueStart, valueEnd);
  }
  // Labelled PIN / pincode only (never a bare 6-digit lab count).
  labelled(
    text,
    /\b((?:PIN\s*Code|Pin\s*Code|Pincode|PIN|पिन(?:\s*कोड)?|পিন(?:\s*কোড)?)\s*[:.#=-]?\s*)([1-9]\d{2}\s?\d{3})\b/gi,
    "pin",
    out,
  );

  // Whole-line addresses: keywords and/or city+PIN, excluding clinical lines.
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const { lineStart, lineEnd, line } = lineBounds(text, searchFrom);
    searchFrom = lineEnd + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (LINE_START_CLINICAL.test(trimmed) || NEW_SECTION_LABEL.test(trimmed)) {
      // Still allow "Address:" which is handled above; skip other labelled clinical lines.
      continue;
    }
    // Skip lines already captured as labelled address values (loose overlap ok).
    const hasKw = ADDRESS_KEYWORDS.test(trimmed);
    const hasCityPin = lineHasCityPin(trimmed);
    const hasPin = /\b[1-9]\d{2}\s?\d{3}\b/.test(trimmed);
    if (!(hasCityPin || (hasKw && hasPin))) continue;
    // Redact from the first address-like token to the end of the line (plus continuations).
    const startInLine = firstAddressIndex(line);
    const absStart = lineStart + startInLine;
    const absEnd = extendAddressEnd(text, lineEnd);
    add(out, "address", text, absStart, absEnd);
  }
  return out;
}

function firstAddressIndex(line: string): number {
  const candidates: number[] = [];
  const kw = line.search(ADDRESS_KEYWORDS);
  if (kw >= 0) candidates.push(kw);
  const house = line.search(/\b(?:(?:h\.?\s*no\.?|house\s*no\.?|door\s*no\.?|plot\s*no\.?|flat|apt\.?|#)\s*\w+)/i);
  if (house >= 0) candidates.push(house);
  const leadingNum = line.search(/^\s*\d{1,5}\s*[,\/-]/);
  if (leadingNum >= 0) candidates.push(line.slice(leadingNum).search(/\S/) + leadingNum);
  const city = line.search(/\b[A-Za-z]/);
  if (candidates.length === 0 && city >= 0) return city;
  return candidates.length ? Math.min(...candidates) : 0;
}

const NAME_TOKEN = /[A-Za-z\u0900-\u097F\u0980-\u09FF][A-Za-z\u0900-\u097F\u0980-\u09FF.'’-]*/;

function consumeName(text: string, from: number): { start: number; end: number } | null {
  let i = from;
  while (i < text.length && /[ \t]/.test(text.charAt(i))) i += 1;
  const start = i;
  let end = start;
  let tokens = 0;
  while (i < text.length && tokens < 6) {
    const ch = text.charAt(i);
    if (ch === "\n") break;
    if (ch === "," || ch === ";" || ch === "|") break;
    // Age/sex like 45/M or 32 F immediately after the name.
    if (/\d/.test(ch)) break;
    const slice = text.slice(i);
    const tok = slice.match(NAME_TOKEN);
    if (!tok || tok.index !== 0) break;
    const word = tok[0];
    const lower = word.toLowerCase().replace(/\./g, "");
    if (NAME_STOP_WORDS.has(lower) || NAME_STOP_WORDS.has(word.toLowerCase())) break;
    if (/^\[(?:NAME|ABHA_NUMBER|ABHA_ADDRESS|ABHA|PHONE|ADDRESS|REG_NO|EMAIL|AADHAAR|UHID|ID|PIN|DOB|DATE|PAN|VID)\]$/.test(word)) break;
    if (ORG_SUFFIX.test(" " + word) || ORG_SUFFIX.test("'s " + word) || ORG_SUFFIX.test("\u2019s " + word)) break;
    end = i + word.length;
    i = end;
    tokens += 1;
    while (i < text.length && /[ \t]/.test(text.charAt(i))) i += 1;
  }
  if (tokens === 0 || end <= start) return null;
  return trimSpan(text, start, end);
}

function findNames(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];

  const labels: RegExp[] = [
    /(?:^|\n)[ \t]*((?:patient(?:'s)?\s+name|patient\s*name|pt\.?\s*name|patient|pt\.?|name)\s*[:.#=-]\s*)/gi,
    /(?:^|\n)[ \t]*((?:doctor(?:'s)?\s+name|physician(?:'s)?\s+name|consultant|prescribed\s+by|referred\s+by|examined\s+by|treating\s+(?:doctor|physician)|doctor|physician)\s*[:.#=-]\s*)/gi,
    // Hindi / Bangla
    /(?:^|\n)[ \t]*((?:नाम|रोगी(?:\s*का)?(?:\s*नाम)?|मरीज(?:\s*का)?(?:\s*नाम)?|डॉक्टर(?:\s*का)?(?:\s*नाम)?|चिकित्सक)\s*[:.#=-]\s*)/g,
    /(?:^|\n)[ \t]*((?:নাম|রোগীর?\s*নাম|ডাক্তার(?:ের)?\s*নাম)\s*[:.#=-]\s*)/g,
  ];

  for (const re of labels) {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      const label = m[1] ?? m[0];
      const from = m.index + m[0].length;
      const name = consumeName(text, from);
      if (!name) continue;
      // Bare "Name:" on a medicine line should not fire.
      const labelText = label.replace(/\s+/g, " ").trim().toLowerCase();
      if (
        /^(name[:.#=\-\s]*)$/.test(labelText) &&
        CLINICAL_AFTER_NAME.test(text.slice(name.start, lineBounds(text, name.start).lineEnd))
      ) {
        continue;
      }
      add(out, "name", text, name.start, name.end);
      const cont = nameContinuation(text, name.end);
      if (cont) add(out, "name", text, cont.start, cont.end);
    }
  }

  // Titles: Mr./Mrs./Ms./Miss/Smt./Shri/Dr./Prof. and Devanagari/Bangla honorifics.
  const titleRe =
    /(?:^|[^\w\u0900-\u097F\u0980-\u09FF])((?:Dr|Drs|Prof|Mr|Mrs|Ms|Miss|Master|Smt|Shri|Shree|Sri)\.?\s+|डॉ\.?\s+|डॉक्टर\s+|श्रीमती\s+|श्री\s+|ডাঃ\s+|ডঃ\s+|ডাক্তার\s+|শ্রীমতী\s+|শ্রী\s+)/g;
  for (const m of text.matchAll(titleRe)) {
    if (m.index === undefined || m[1] === undefined) continue;
    const prefixStart = m.index + m[0].length - m[1].length;
    const from = prefixStart + m[1].length;
    const name = consumeName(text, from);
    if (!name) continue;
    const after = text.slice(name.end);
    if (ORG_SUFFIX.test(after)) continue;
    add(out, "name", text, name.start, name.end);
  }

  // S/o, D/o, W/o, C/o and spelled-out forms (son of, wife of, …).
  const relRe =
    /(?:^|[^\w\u0900-\u097F\u0980-\u09FF])((?:(?:son|daughter|wife|husband|father|mother|care)\s+of|[SDWC]\/[Oo]|s\/o|d\/o|w\/o|c\/o)\s+(?:late\s+)?)/gi;
  for (const m of text.matchAll(relRe)) {
    if (m.index === undefined || m[1] === undefined) continue;
    const from = m.index + m[0].length;
    const name = consumeName(text, from);
    if (name) add(out, "name", text, name.start, name.end);
    // Name immediately before the relation cue ("sunita devi w/o …").
    const before = consumeNameBackward(text, m.index + m[0].length - m[1].length);
    if (before) add(out, "name", text, before.start, before.end);
  }

  for (const s of findSeedNames(text)) out.push(s);
  return out;
}


function consumeNameBackward(text: string, end: number): { start: number; end: number } | null {
  let i = end;
  while (i > 0 && /[ \t]/.test(text.charAt(i - 1))) i -= 1;
  const right = i;
  let tokens = 0;
  while (i > 0 && tokens < 6) {
    const ch = text.charAt(i - 1);
    if (ch === "\n" || ch === "," || ch === ";" || ch === "|") break;
    if (/\d/.test(ch)) break;
    let j = i;
    while (j > 0 && /[A-Za-z\u0900-\u097F\u0980-\u09FF.'’-]/.test(text.charAt(j - 1))) j -= 1;
    if (j === i) break;
    const word = text.slice(j, i);
    const lower = word.toLowerCase().replace(/\./g, "");
    if (NAME_STOP_WORDS.has(lower) || NAME_STOP_WORDS.has(word.toLowerCase())) break;
    i = j;
    tokens += 1;
    while (i > 0 && /[ \t]/.test(text.charAt(i - 1))) i -= 1;
  }
  if (tokens === 0) return null;
  return trimSpan(text, i, right);
}

function nameContinuation(text: string, after: number): { start: number; end: number } | null {
  if (text.charAt(after) !== "\n") return null;
  const nextStart = after + 1;
  const { lineEnd, line } = lineBounds(text, nextStart);
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (LINE_START_CLINICAL.test(trimmed) || NEW_SECTION_LABEL.test(trimmed)) return null;
  if (/\d/.test(trimmed)) return null;
  const name = consumeName(text, nextStart);
  if (!name) return null;
  if (text.slice(name.end, lineEnd).trim()) return null;
  return name;
}

function findSeedNames(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  let offset = 0;
  for (const rawLine of text.split("\n")) {
    const tokenRe = /[A-Za-z\u0900-\u097F\u0980-\u09FF][A-Za-z\u0900-\u097F\u0980-\u09FF.']*/g;
    const tokens: { start: number; end: number; word: string }[] = [];
    for (const m of rawLine.matchAll(tokenRe)) {
      if (m.index === undefined) continue;
      tokens.push({ start: offset + m.index, end: offset + m.index + m[0].length, word: m[0] });
    }
    let i = 0;
    while (i < tokens.length) {
      const first = tokens[i];
      const second = tokens[i + 1];
      if (first && second && isNameToken(first.word) && isNameToken(second.word)) {
        let j = i + 2;
        while (j < tokens.length && j - i < 4) {
          const tok = tokens[j];
          if (!tok || !isNameToken(tok.word)) break;
          j += 1;
        }
        const last = tokens[j - 1];
        if (last) add(out, "name", text, first.start, last.end);
        i = j;
        continue;
      }
      i += 1;
    }
    offset += rawLine.length + 1;
  }
  return out;
}

const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

function isPlausibleNumericDate(s: string): boolean {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  }
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const yRaw = Number(m[3]);
  const year = yRaw < 100 ? (yRaw >= 30 ? 1900 + yRaw : 2000 + yRaw) : yRaw;
  if (year < 1900 || year > 2100) return false;
  const monthOk = (x: number) => x >= 1 && x <= 12;
  const dayOk = (x: number) => x >= 1 && x <= 31;
  return (dayOk(a) && monthOk(b)) || (monthOk(a) && dayOk(b));
}

function findDob(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  const label =
    /(?:\b(?:d\.?\s*o\.?\s*b\.?|date\s*of\s*birth|birth\s*date|born\s+on)|जन्म\s*(?:तिथि|तारीख|दिनांक)?)\s*[:.#=-]?\s*/gi;
  const dateAfter = new RegExp(
    "^(?:\\d{1,2}[/.\-]\\d{1,2}[/.\-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+" + MONTH + "\\s*,?\\s*\\d{2,4})",
    "i",
  );
  for (const m of text.matchAll(label)) {
    if (m.index === undefined) continue;
    const from = m.index + m[0].length;
    const slice = text.slice(from);
    const dm = slice.match(dateAfter);
    if (!dm || dm.index !== 0) continue;
    add(out, "dob", text, from, from + dm[0].length);
  }
  return out;
}

function findDates(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  const numeric = /\b(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;
  for (const m of text.matchAll(numeric)) {
    if (m.index === undefined || m[1] === undefined) continue;
    if (!isPlausibleNumericDate(m[1])) continue;
    add(out, "date", text, m.index, m.index + m[0].length);
  }
  const words = new RegExp(
    "\\b(\\d{1,2}(?:st|nd|rd|th)?\\s+" + MONTH + "\\s*,?\\s*\\d{2,4})\\b",
    "gi",
  );
  for (const m of text.matchAll(words)) {
    if (m.index === undefined) continue;
    add(out, "date", text, m.index, m.index + m[0].length);
  }
  return out;
}

function findPan(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  const re = /\b([A-Za-z]{5}\d{4}[A-Za-z])\b/g;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined) continue;
    add(out, "pan", text, m.index, m.index + m[0].length);
  }
  return out;
}

function findVid(text: string): PhiSpan[] {
  const out: PhiSpan[] = [];
  labelled(
    text,
    /\b((?:VID|Virtual\s*ID)\s*[:.#=-]?\s*)(\d{4}(?:[\s-]\d{4}){3}|\d{16})\b/gi,
    "vid",
    out,
  );
  return out;
}

const TYPE_PRIORITY: Record<PhiType, number> = {
  abha_number: 9,
  abha_address: 9,
  aadhaar: 8,
  vid: 8,
  pan: 8,
  dob: 7,
  date: 7,
  email: 6,
  phone: 5,
  uhid: 4,
  reg_no: 4,
  pin: 3,
  address: 2,
  name: 1,
};

function resolveOverlaps(spans: PhiSpan[]): PhiSpan[] {
  const sorted = [...spans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const len = b.end - b.start - (a.end - a.start);
    if (len !== 0) return len;
    return TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type];
  });
  const out: PhiSpan[] = [];
  for (const s of sorted) {
    if (s.end <= s.start) continue;
    const last = out[out.length - 1];
    if (!last || s.start >= last.end) {
      out.push({ type: s.type, start: s.start, end: s.end });
      continue;
    }
    // Same start: keep the more specific (or already-kept longer) span.
    if (s.start === last.start && TYPE_PRIORITY[s.type] > TYPE_PRIORITY[last.type] && s.end >= last.end) {
      out[out.length - 1] = { type: s.type, start: s.start, end: s.end };
      continue;
    }
    // Higher-priority span inside a broader address/name: keep the inner
    // identifier and split the outer span around it.
    if (s.start >= last.start && s.end <= last.end && TYPE_PRIORITY[s.type] > TYPE_PRIORITY[last.type]) {
      const headEnd = s.start;
      const tailStart = s.end;
      const outer = last;
      out.pop();
      if (headEnd - outer.start > 0) out.push({ type: outer.type, start: outer.start, end: headEnd });
      out.push({ type: s.type, start: s.start, end: s.end });
      if (outer.end - tailStart > 0) {
        // The tail is re-considered against later spans by pushing it back
        // through a simple append; later inner hits are handled in this loop
        // only against the last span, so keep tails as a pending outer.
        out.push({ type: outer.type, start: tailStart, end: outer.end });
      }
    }
  }
  // Split tails can be out of order or abut empties; normalise.
  return out
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<PhiSpan[]>((acc, s) => {
      const prev = acc[acc.length - 1];
      if (!prev || s.start >= prev.end) acc.push(s);
      else if (s.start >= prev.start && s.end <= prev.end && TYPE_PRIORITY[s.type] > TYPE_PRIORITY[prev.type]) {
        const head = { type: prev.type, start: prev.start, end: s.start };
        const tail = { type: prev.type, start: s.end, end: prev.end };
        acc.pop();
        if (head.end > head.start) acc.push(head);
        acc.push(s);
        if (tail.end > tail.start) acc.push(tail);
      }
      return acc;
    }, []);
}

function findRedactions(text: string): PhiSpan[] {
  if (!text) return [];
  const { view, toOrig, toOrigEnd } = preprocess(text);
  const all = [
    ...findAbha(view),
    ...findAadhaar(view),
    ...findVid(view),
    ...findPan(view),
    ...findEmails(view),
    ...findPhones(view),
    ...findRegNos(view),
    ...findUhids(view),
    ...findAddresses(view),
    ...findNames(view),
    ...findDob(view),
    ...findDates(view),
  ];
  const mapped: PhiSpan[] = [];
  for (const s of resolveOverlaps(all)) {
    const orig = mapSpanToOrig(s.start, s.end, toOrig, toOrigEnd);
    if (!orig) continue;
    mapped.push({ type: s.type, start: orig.start, end: orig.end });
  }
  return resolveOverlaps(mapped);
}

function collapseWhitespace(s: string): string {
  // Trim spaces before newlines (core does this). We do *not* collapse
  // interior runs of spaces, so aligned lab tables and double-spaced
  // clinical text stay intact when nothing (or only a header) was redacted.
  return s.replace(/ +\n/g, "\n");
}

function applyRedactions(text: string, redactions: PhiSpan[]): string {
  let out = "";
  let i = 0;
  for (const r of redactions) {
    out += text.slice(i, r.start);
    out += PLACEHOLDERS[r.type];
    if (r.type === "name") {
      const next = r.end < text.length ? text.charAt(r.end) : "";
      if (next && next !== " " && next !== "\n" && next !== "\t") out += " ";
    }
    i = r.end;
  }
  out += text.slice(i);
  return collapseWhitespace(out);
}

/**
 * Deterministic de-identification, run on-device before any text is sent to
 * a cloud model. Drop-in superset of `@med-ocr/core`'s `deidentify`:
 * same function name, PhiType counts, `total`, and core placeholders, plus
 * `spans`, address/PIN coverage, Hindi/Bangla labels, landlines, and
 * `assertSafeForCloud`.
 *
 * Rule-based: labelled-context heuristics plus high-precision patterns.
 * It is not a guarantee of anonymisation.
 *
 * Redacted: patient/doctor names (when labelled or titled), ABHA numbers and
 * addresses, Indian phone numbers, postal addresses / PIN codes, doctor
 * registration numbers, emails, Aadhaar (grouped 4-4-4 or 12-digit, as in
 * core), and labelled UHID/MRN.
 *
 * Preserved: drug names, doses, frequencies, durations, lab values, units,
 * reference ranges, and an age in years when it is printed on the document.
 * Dates of birth are replaced with [DOB]; every other calendar date with [DATE].
 *
 * Known gaps:
 * - Unlabelled names outside the Indian name seed list, and without a label
 *   or relation cue, can slip through.
 * - Images, letterheads, stamps and signatures are not redacted.
 * - OCR-garbled labels may miss.
 * - Unlabelled 12-digit Aadhaar (ported from core) can false-positive on
 *   a 12-digit instrument or accession number.
 * - Hospital/clinic names are left unless they look like "Dr. <person>"
 *   without an organisation suffix.
 */

export function deidentify(input: string): DeidResult {
  const text = input ?? "";
  const spans = findRedactions(text);
  const redactions: Partial<Record<PhiType, number>> = {};
  for (const s of spans) {
    redactions[s.type] = (redactions[s.type] ?? 0) + 1;
  }
  return {
    text: applyRedactions(text, spans),
    redactions,
    total: spans.length,
    spans,
  };
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export class UnsafeForCloudError extends Error {
  readonly findings: PhiSpan[];
  constructor(findings: PhiSpan[], sample: string) {
    const preview = findings
      .slice(0, 6)
      .map((f) => `${f.type}@${f.start}-${f.end} (${JSON.stringify(sample.slice(f.start, f.end))})`)
      .join("; ");
    super(`Text is not safe to send to the cloud: ${findings.length} residual identifier(s): ${preview}`);
    this.name = "UnsafeForCloudError";
    this.findings = findings;
  }
}

/**
 * Fail-closed guard. Throws if any de-identification pattern still matches.
 * Call after deidentify() (or on text that should already be clean) and
 * before a cloud request. Does not inspect images.
 */
export function assertSafeForCloud(text: string): void {
  const findings = findRedactions(text ?? "");
  if (findings.length > 0) {
    throw new UnsafeForCloudError(findings, text ?? "");
  }
}
