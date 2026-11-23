// SPDX-License-Identifier: Apache-2.0
/**
 * De-identification types for text that may leave the device.
 *
 * The SoalTech handoff (23 Nov 2026) does not classify dates as PII, so
 * clinical dates (and DOB/age) are left intact. See known gaps in the
 * module docs of deidentify.ts.
 */

export type RedactionType =
  | "name"
  | "abha"
  | "phone"
  | "address"
  | "reg_no"
  | "email"
  | "aadhaar"
  | "uhid";

export interface Redaction {
  type: RedactionType;
  /** Inclusive start offset in the original (pre-redaction) string. */
  start: number;
  /** Exclusive end offset in the original (pre-redaction) string. */
  end: number;
}

export interface DeidentifyResult {
  text: string;
  redactions: Redaction[];
}

export interface FieldRedaction extends Redaction {
  /** JS-style path, e.g. rawText or medications[0].sourceText */
  path: string;
}

export interface DeidentifyFieldsResult<T> {
  doc: T;
  redactions: FieldRedaction[];
}

export const PLACEHOLDERS: Record<RedactionType, string> = {
  name: "[NAME]",
  abha: "[ABHA]",
  phone: "[PHONE]",
  address: "[ADDRESS]",
  reg_no: "[REG_NO]",
  email: "[EMAIL]",
  aadhaar: "[AADHAAR]",
  uhid: "[UHID]",
};

export const PLACEHOLDER_VALUES = new Set(Object.values(PLACEHOLDERS));
