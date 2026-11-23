// SPDX-License-Identifier: Apache-2.0
/**
 * Small RFC 4180 CSV parser (UTF-8, optional BOM, quoted multiline fields).
 * Kept dependency-free so the importer does not change the root lockfile.
 */

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(stripBom(text));
  const headerRow = rows[0];
  if (!headerRow || headerRow.length === 0) {
    return [];
  }
  const headers = headerRow.map((h) => h.trim());
  const records: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (row.length === 1 && (row[0] ?? "").trim() === "") continue;
    const rec: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      rec[key] = row[c] ?? "";
    }
    records.push(rec);
  }
  return records;
}

export function parseCsvRows(text: string): string[][] {
  const src = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = src[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || (row[0] ?? "") !== "" || rows.length === 0) {
        rows.push(row);
      }
      row = [];
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (inQuotes) {
    throw new Error("Unterminated quoted CSV field");
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
