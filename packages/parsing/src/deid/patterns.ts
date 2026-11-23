// SPDX-License-Identifier: Apache-2.0

/** Placeholder tokens produced by deidentify(); finders must ignore these. */
export const PLACEHOLDER_TOKEN =
  /\[(?:NAME|ABHA_NUMBER|ABHA_ADDRESS|ABHA|PHONE|ADDRESS|REG_NO|EMAIL|AADHAAR|UHID|ID|PIN|DOB|DATE|PAN|VID)\]/g;

/** Words that end a person-name capture. */
export const NAME_STOP_WORDS = new Set(
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
export const CLINICAL_AFTER_NAME =
  /\d+\s*(?:mg|mcg|ug|µg|g|gm|ml|iu|i\.u\.|units?|%|meq|mmol|mcg|tab|cap|syp)|(?:\b(?:tab|cap|syp|syrup|inj|injection|tablet|capsule|drops?|suspension|ointment|cream)\b)/i;

/** Organisation / manufacturer suffixes after "Dr. …" (do not redact). */
export const ORG_SUFFIX =
  /^(?:['’]s)?\s+(?:laborator(?:y|ies)|labs?|ltd\.?|pvt\.?|private|limited|pharma\b|pharmaceuticals?|hospital|clinic|nursing|medical\s+(?:college|centre|center|institute)|diagnostic|healthcare|health\s*care)\b/i;

export const ADDRESS_KEYWORDS =
  /\b(?:street|st\.|road|rd\.|marg|nagar|lane|cross|block|sector|phase|flat|apartment|apartments|apt\.?|house\s*no\.?|h\.?\s*no\.?|door\s*no\.?|plot\s*no\.?|villa|colony|layout|enclave|extension|society|village|vill\.|p\.?\s*o\.?|post\s*office|tehsil|taluk|taluka|district|dist\.|opp\.|opposite|near|behind|chowk|ganj|bhavan|niwas|floor|wing|premises|township|pg\b|residency|apartment|appt)\b/i;

/** Used only together with a 6-digit PIN, never as a standalone redaction. */
export const CITY_NAMES = new Set(
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

export const LINE_START_CLINICAL =
  /^(?:tab(?:let)?|cap(?:sule)?|syp|syrup|inj(?:ection)?|rx|dose|frequency|duration|investigation|hemoglobin|haemoglobin|wbc|rbc|platelet|hba1c|creatinine|glucose|tsh|fbs|ppbs|rbs|urea|bilirubin|cholesterol|triglyceride|sgot|sgpt|alt|ast|sodium|potassium|chloride)\b/i;

/** Next-line labels that end a multi-line address. */
export const NEW_SECTION_LABEL =
  /^(?:age|sex|gender|dob|d\.o\.b|date|dated|phone|ph\.?|mob(?:ile)?|tel(?:ephone)?|email|e-mail|abha|aadhaar|aadhar|patient|pt\.?|doctor|dr\.?|rx|diagnosis|advice|history|chief|investigation|test|uhid|mrn|reg(?:istration)?|ref(?:erred)?|weight|height|bp|pulse|temp)\b/i;
