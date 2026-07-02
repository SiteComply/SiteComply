/**
 * Minimal, dependency-free CSV serialisation shared by the platform export
 * routes. Quotes any cell containing a comma, quote or newline (RFC 4180) and
 * joins rows with CRLF for maximum spreadsheet compatibility.
 */

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV document from a header row and data rows. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  return [header, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}
