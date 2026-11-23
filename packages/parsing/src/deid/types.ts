// SPDX-License-Identifier: Apache-2.0
/**
 * De-identification types. `PhiType`, `DeidResult`, `deidentify` and
 * `utf8Bytes` are a drop-in superset of `@med-ocr/core`'s deid module.
 *
 * Dates of birth are always redacted (`[DOB]`). Every other calendar date
 * is replaced with `[DATE]` before text may leave the device. An age in
 * years printed on the document may stay. `assertSafeForCloud` blocks any
 * residual date or DOB.
 */

export type PhiType =
  | "aadhaar"
  | "abha_number"
  | "abha_address"
  | "phone"
  | "email"
  | "name"
  | "reg_no"
  | "uhid"
  | "address"
  | "pin"
  | "dob"
  | "date"
  | "pan"
  | "vid";

/** @deprecated Use PhiType. Kept so early parsing tests/callers can migrate. */
export type RedactionType = PhiType;

export interface PhiSpan {
  type: PhiType;
  /** Inclusive start offset in the original (pre-redaction) string. */
  start: number;
  /** Exclusive end offset in the original (pre-redaction) string. */
  end: number;
}

/** @deprecated Use PhiSpan. */
export type Redaction = PhiSpan;

export interface DeidResult {
  text: string;
  /** Count of redactions per type, matching core's return shape. */
  redactions: Partial<Record<PhiType, number>>;
  total: number;
  /** Offsets into the original input, before placeholders and whitespace collapse. */
  spans?: PhiSpan[];
}

/** @deprecated Use DeidResult. */
export type DeidentifyResult = DeidResult;

export interface FieldRedaction extends PhiSpan {
  /** JS-style path, e.g. rawText or medications[0].sourceText */
  path: string;
}

export interface DeidentifyFieldsResult<T> {
  doc: T;
  redactions: FieldRedaction[];
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

export const PLACEHOLDER_VALUES = new Set(Object.values(PLACEHOLDERS));
