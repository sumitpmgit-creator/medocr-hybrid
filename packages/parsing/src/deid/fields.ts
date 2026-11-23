// SPDX-License-Identifier: Apache-2.0
import { deidentify } from "./deidentify.js";
import { PLACEHOLDERS, type DeidentifyFieldsResult, type FieldRedaction, type PhiType } from "./types.js";

function keyNorm(key: string): string {
  return key.replace(/[_\s-]/g, "").toLowerCase();
}

/**
 * True when a path clearly names a person or contact field, and is not a
 * medication/lab `name` (drug or test name).
 */
export function piiFieldType(key: string, path: string): PhiType | null {
  const k = keyNorm(key);
  const p = path.toLowerCase();
  if (/(?:medications|medication|meds|drugs|labresults|lab_results|labs)\[\d+\]\.(?:name|genericname)$/.test(p)) {
    return null;
  }
  if (/(?:patient|doctor|physician|consultant|prescriber|person).*(?:name|firstname|lastname|fullname)|(?:name|firstname|lastname|fullname).*(?:patient|doctor|physician|consultant)/.test(p.replace(/[_\s-]/g, "")) ||
      /^(?:patient|doctor|physician|consultant|prescriber)(?:full)?name$/.test(k) ||
      /^(?:firstname|lastname|fullname|givenname|surname|patient|doctor)$/.test(k)) {
    // "name" under medications already excluded; a top-level or patient.name is PII.
    if (k === "name" || k.endsWith("name") || k === "patient" || k === "doctor") return "name";
  }
  if (k === "name" && /(?:patient|doctor|physician|consultant|prescriber)/.test(p)) return "name";
  if (/^(?:phone|phoneno|phonenumber|mobile|mobileno|tel|telephone|contact|contactno|landline|whatsapp)$/.test(k)) {
    return "phone";
  }
  if (/^(?:email|emailid|emailaddress)$/.test(k)) return "email";
  if (/^(?:abhaaddress)$/.test(k)) return "abha_address";
  if (/^(?:abha|abhaid|abhanumber)$/.test(k)) return "abha_number";
  if (/^(?:pin|pincode|pincodeno)$/.test(k)) return "pin";
  if (/^(?:aadhaar|aadhar|uidai|uid)$/.test(k)) return "aadhaar";
  if (/^(?:address|addr|residentialaddress)$/.test(k)) return "address";
  if (/^(?:regno|registration|registrationno|registrationnumber|mcino|nmcno)$/.test(k)) return "reg_no";
  if (/^(?:uhid|mrn|patientid|hospitalid)$/.test(k)) return "uhid";
  if (/^(?:dob|dateofbirth|birthdate)$/.test(k)) return "dob";
  if (/^(?:date|visitdate|reportdate|collectiondate)$/.test(k)) return "date";
  if (/^(?:pan|panno|pannumber)$/.test(k)) return "pan";
  if (/^(?:vid|aadhaarvid)$/.test(k)) return "vid";
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function walk(value: unknown, path: string, redactions: FieldRedaction[]): unknown {
  if (typeof value === "string") {
    const key = path.includes(".") || path.includes("[")
      ? (path.split(".").pop() ?? path).replace(/\[\d+\]/g, "")
      : path;
    const wholesale = piiFieldType(key, path);
    if (wholesale && value.trim() && !/^\[(?:NAME|ABHA_NUMBER|ABHA_ADDRESS|ABHA|PHONE|ADDRESS|REG_NO|EMAIL|AADHAAR|UHID|ID|PIN|DOB|DATE|PAN|VID)\]$/.test(value.trim())) {
      redactions.push({ type: wholesale, path, start: 0, end: value.length });
      return PLACEHOLDERS[wholesale];
    }
    const result = deidentify(value);
    for (const r of result.spans ?? []) {
      redactions.push({ ...r, path });
    }
    return result.text;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => walk(item, `${path}[${i}]`, redactions));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const child = path ? `${path}.${k}` : k;
      if (typeof v !== "string" && typeof v !== "object") {
        out[k] = v;
        continue;
      }
      out[k] = walk(v, child, redactions);
    }
    return out;
  }
  return value;
}

/**
 * Deep-copy a structured extraction result (NanoExtraction, ClinicalFields,
 * or a ClinicalDoc-like object) and de-identify every string. Known PII
 * property names are replaced wholesale; clinical fields are only scanned
 * for residual identifiers.
 */
export function deidentifyFields<T>(doc: T): DeidentifyFieldsResult<T> {
  if (doc === null || doc === undefined) {
    return { doc, redactions: [] };
  }
  const redactions: FieldRedaction[] = [];
  const copy = walk(doc, "", redactions) as T;
  return { doc: copy, redactions };
}
