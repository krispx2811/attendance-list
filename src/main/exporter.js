'use strict';

/**
 * CSV and Excel export.
 *
 * Both formats share one column layout so a spreadsheet built from either is
 * interchangeable.
 */

const fs = require('node:fs');
const ExcelJS = require('exceljs');

const HEADERS = ['Date', 'Name', 'Status', 'Reason for not coming', 'Recorded at'];

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };

const STATUS_FILL = {
  Present: 'FFE2F0D9',
  Late: 'FFFFF2CC',
  Absent: 'FFFBE5E5',
};

const toRecords = (rows) =>
  rows.map((r) => [r.date, r.name, r.status, r.reason || '', r.recorded_at]);

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(rows, destination) {
  const lines = [HEADERS.map(csvCell).join(',')];
  for (const record of toRecords(rows)) lines.push(record.map(csvCell).join(','));
  // The BOM makes Excel on Windows read accented names correctly.
  fs.writeFileSync(destination, '﻿' + lines.join('\r\n'), 'utf8');
  return destination;
}

function styleHeader(sheet) {
  const row = sheet.getRow(1);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
}

function autosize(sheet, min = 10, max = 45) {
  sheet.columns.forEach((column) => {
    let longest = 0;
    column.eachCell({ includeEmpty: false }, (cell) => {
      longest = Math.max(longest, String(cell.value ?? '').length);
    });
    column.width = Math.max(min, Math.min(max, longest + 3));
  });
}

async function exportXlsx(rows, destination, sheetTitle = 'Attendance') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Attendance List';
  wb.created = new Date();

  const sheet = wb.addWorksheet(String(sheetTitle).slice(0, 31) || 'Attendance');
  sheet.addRow(HEADERS);
  for (const record of toRecords(rows)) sheet.addRow(record);

  styleHeader(sheet);

  // Tint each row by status so absences stand out when scanning.
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const colour = STATUS_FILL[row.getCell(3).value];
    if (!colour) return;
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
    });
  });

  autosize(sheet);
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: { row: sheet.rowCount, column: HEADERS.length } };

  await wb.xlsx.writeFile(destination);
  return destination;
}

/** Workbook with the raw records plus a per-person summary and reasons. */
async function exportSummaryXlsx(rows, stats, reasons, destination) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Attendance List';
  wb.created = new Date();

  const records = wb.addWorksheet('Records');
  records.addRow(HEADERS);
  for (const record of toRecords(rows)) records.addRow(record);
  styleHeader(records);
  autosize(records);
  records.views = [{ state: 'frozen', ySplit: 1 }];

  const summary = wb.addWorksheet('Summary');
  summary.addRow(['Name', 'Recorded days', 'Present', 'Late', 'Absent', 'Attendance rate']);
  for (const s of stats) {
    const recorded = s.recorded || 0;
    const attended = (s.present || 0) + (s.late || 0);
    summary.addRow([
      s.name,
      recorded,
      s.present || 0,
      s.late || 0,
      s.absent || 0,
      recorded ? attended / recorded : 0,
    ]);
  }
  summary.getColumn(6).numFmt = '0%';
  styleHeader(summary);
  autosize(summary);
  summary.views = [{ state: 'frozen', ySplit: 1 }];

  const reasonSheet = wb.addWorksheet('Reasons');
  reasonSheet.addRow(['Reason', 'Times given']);
  for (const r of reasons) reasonSheet.addRow([r.reason, r.n]);
  styleHeader(reasonSheet);
  autosize(reasonSheet);

  await wb.xlsx.writeFile(destination);
  return destination;
}

module.exports = { HEADERS, exportCsv, exportXlsx, exportSummaryXlsx };
