/**
 * Client-side export of a single ArcGPT answer.
 *
 * Deliberately dependency-free and self-contained: the chat already holds the
 * answer prose and its result rows in memory, so exporting needs no API call,
 * no backend endpoint and no new package. The backend already caps a result at
 * `MAX_RESULT_ROWS` (500), which is also everything the on-screen table shows,
 * so the exported data is exactly the data the user was looking at.
 *
 * The PDF is produced by a print window rather than a PDF library. Every
 * browser can turn a print dialog into a PDF ("Save as PDF" on Chromium,
 * "Print to PDF" on Firefox, "Save as PDF" on Safari), it needs no ~350KB
 * dependency, and the printed layout — repeating table headers, page breaks
 * between rows — is handled natively. This mirrors what
 * `components/ResultViewer.tsx` already does for the admin result view.
 */

/** The parts of one assistant turn worth exporting. */
export interface ExportableAnswer {
  /** The user turn that produced the answer, when it is known. */
  question: string;
  /** The assistant's prose answer, which is markdown. */
  answer: string;
  /** The backend's `QueryExecutionStatus`, e.g. `success` or `empty`. */
  status: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Rows written to the print preview. Generous, but not unbounded. */
const MAX_PRINT_ROWS = 500;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `student_full_name` → `Student Full Name`, for report headings. */
function humanizeColumn(column: string): string {
  return column
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One CSV field.
 *
 * Numbers and booleans are emitted bare so a spreadsheet keeps them numeric,
 * which matters here — a column of `"-12"` would otherwise be read as text.
 * Strings that begin with `=`, `+`, `-` or `@` are prefixed with an apostrophe
 * so a cell cannot execute as a formula when the file is opened in Excel or
 * Sheets; that is a real risk because row values come from an LLM's SQL
 * result and are not vetted as spreadsheet input. Object cells are serialised
 * as JSON, matching how the on-screen table renders them.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return String(value);
    }
  }

  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * The CSV file contents.
 *
 * A metadata block first, then a blank line, then the result table padded out
 * so the two sections line up in a spreadsheet. Padding rather than ragged rows
 * keeps the columns readable when the table is wider than the two metadata
 * fields. A turn with no result table (an `empty` answer, or a transcript
 * restored from history) still produces a valid file carrying the prose.
 */
export function buildAnswerCsv(payload: ExportableAnswer, generatedAt: Date): string {
  const { question, answer, status, columns, rows } = payload;
  const pad = Array.from({ length: Math.max(0, columns.length - 2) }, () => '');

  const metadata: Array<[string, string]> = [
    ['Question', question],
    ['Answer', answer],
    ['Status', status],
    ['Rows', String(rows.length)],
    ['Exported', generatedAt.toISOString()],
  ];

  const lines: string[] = metadata.map(
    ([label, value]) => [csvCell(label), csvCell(value), ...pad].join(',')
  );

  if (columns.length > 0) {
    lines.push('');
    lines.push(columns.map(csvCell).join(','));
    rows.forEach((row) => lines.push(columns.map((column) => csvCell(row[column])).join(',')));
  }

  return `${lines.join('\r\n')}\r\n`;
}

/** `arcgpt-answer-2026-09-26-142530`, from the export time. */
function exportBaseName(generatedAt: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    'arcgpt-answer',
    generatedAt.getFullYear(),
    pad(generatedAt.getMonth() + 1),
    pad(generatedAt.getDate()),
    '-',
    pad(generatedAt.getHours()),
    pad(generatedAt.getMinutes()),
    pad(generatedAt.getSeconds()),
  ].join('');
}

/**
 * Saves the CSV through a blob rather than a `data:` URI.
 *
 * A data URI has a length ceiling in some browsers and percent-encodes the
 * whole payload into the URL, which is both slow and needlessly fragile for a
 * 500-row result. The object URL is revoked on the next tick, once the
 * download has been handed to the browser.
 */
export function downloadAnswerCsv(payload: ExportableAnswer, generatedAt = new Date()): void {
  const blob = new Blob([buildAnswerCsv(payload, generatedAt)], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${exportBaseName(generatedAt)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The answer as it appears in the on-screen table, for the printed report. */
function displayCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function buildPrintDocument(payload: ExportableAnswer, generatedAt: Date): string {
  const { question, answer, status, columns, rows } = payload;
  const shownRows = rows.slice(0, MAX_PRINT_ROWS);

  const table =
    columns.length === 0
      ? '<p class="empty">This answer returned no result table.</p>'
      : `
        <table>
          <thead>
            <tr>${columns.map((column) => `<th>${escapeHtml(humanizeColumn(column))}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${shownRows
              .map(
                (row) =>
                  `<tr>${columns
                    .map((column) => `<td>${escapeHtml(displayCell(row[column]))}</td>`)
                    .join('')}</tr>`
              )
              .join('\n')}
          </tbody>
        </table>
        ${
          rows.length > shownRows.length
            ? `<p class="note">Showing the first ${shownRows.length} of ${rows.length} rows.</p>`
            : ''
        }`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>ArcGPT — ${escapeHtml(question || 'Answer')}</title>
    <style>
      @page { margin: 14mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #1b1b1f;
        background: #fff;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        line-height: 1.5;
      }
      header { border-bottom: 2px solid #e0be70; padding-bottom: 10px; margin-bottom: 18px; }
      .brand { font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #8a6d2f; }
      h1 { margin: 6px 0 0; font-size: 17px; font-weight: 600; line-height: 1.35; }
      .meta { margin: 4px 0 0; color: #6f6e78; font-size: 11px; }
      h2 {
        margin: 22px 0 8px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #6f6e78;
      }
      .answer { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      th {
        text-align: left;
        padding: 7px 9px;
        border-bottom: 1.5px solid #d8d4cc;
        background: #faf8f4;
        font-size: 9.5px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      td { padding: 7px 9px; border-bottom: 1px solid #eceaea; vertical-align: top; overflow-wrap: anywhere; }
      .empty, .note { margin: 8px 0 0; color: #6f6e78; font-size: 11px; }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">ArcGPT</div>
      <h1>${escapeHtml(question || 'Answer')}</h1>
      <p class="meta">Status: ${escapeHtml(status)} &middot; ${rows.length} row${
        rows.length === 1 ? '' : 's'
      } &middot; Exported ${escapeHtml(
        generatedAt.toLocaleString()
      )}</p>
    </header>
    <h2>Answer</h2>
    <p class="answer">${escapeHtml(answer)}</p>
    <h2>Results</h2>
    ${table}
  </body>
</html>`;
}

/**
 * Opens the printable report and calls `print()` on it.
 *
 * Must be called straight from a click handler: the window is opened
 * synchronously, before any `await`, so it is a user gesture and is not
 * blocked as a popup. Returns `false` when the browser refused the popup, which
 * is the only failure mode here — nothing is uploaded and nothing is lost.
 */
export function openAnswerPrintPreview(
  payload: ExportableAnswer,
  generatedAt = new Date()
): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;

  printWindow.document.open();
  printWindow.document.write(buildPrintDocument(payload, generatedAt));
  printWindow.document.close();

  const print = () => {
    printWindow.focus();
    printWindow.print();
  };

  // `document.write` parses asynchronously, so printing has to wait for the
  // document to finish or the dialog measures an unlaid-out page. The
  // readyState check only matters if the blank window had already settled.
  if (printWindow.document.readyState === 'complete') {
    window.setTimeout(print, 150);
  } else {
    printWindow.addEventListener('load', () => window.setTimeout(print, 150), { once: true });
  }

  return true;
}
