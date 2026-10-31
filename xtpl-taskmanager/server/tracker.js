import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { requireAuth } from './auth.js';
import { loadDocuments, saveDocuments, serialize } from './store.js';
import { UPLOAD_DIR, attachmentHeader, safeStoredName } from './uploads.js';
import {
  MAX_ROWS, TRACKER_TEMPLATES, convertManual, convertTable, detectHeaderRow, formatDate,
  getTemplate, mapColumns, parseCsv, rankTemplates,
} from './tracker-core.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SCAN_LIMIT = 20000; // rows read per sheet; guards against sheets formatted down to row 1,048,576
const BLANK_ROWS = 200;   // rows pre-formatted (formats and drop-downs) in every generated sheet

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Could not process the file' });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.xlsx', '.xlsm', '.csv', '.xls'].includes(ext)) return cb(new Error('Upload an Excel (.xlsx) or CSV file'));
    cb(null, true);
  },
});

function handleUpload(req, res, next) {
  upload.single('file')(req, res, err => {
    if (!err) return next();
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The file must be 15 MB or smaller' : (err.message || 'Could not read the upload') });
  });
}

// ---------- reading ----------

function cellValue(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(p => p.text).join('');
    if ('result' in v) return cellValue(v.result);   // formula: use the calculated value
    if ('text' in v) return cellValue(v.text);       // hyperlink
    if ('error' in v) return null;
    return null;
  }
  return v;
}

async function readSheets(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (ext === '.xls') throw new HttpError(400, 'Old .xls files are not supported. Open it in Excel and choose Save As > .xlsx (or .csv), then upload again.');
  if (ext === '.csv') return [{ name: 'CSV', table: parseCsv(file.buffer.toString('utf8')) }];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer);
  } catch {
    throw new HttpError(400, 'This file could not be opened. Make sure it is a real .xlsx file and not password protected.');
  }
  const sheets = [];
  for (const ws of wb.worksheets) {
    const rows = Math.min(ws.rowCount, SCAN_LIMIT);
    const cols = Math.min(ws.columnCount, 60);
    const table = [];
    for (let r = 1; r <= rows; r++) {
      const row = ws.getRow(r);
      const values = [];
      for (let c = 1; c <= cols; c++) values.push(cellValue(row.getCell(c).value));
      table.push(values);
    }
    if (table.some(r => r.some(v => v !== null && String(v).trim() !== ''))) sheets.push({ name: ws.name, table });
  }
  if (!sheets.length) throw new HttpError(422, 'The file has no data in it.');
  return sheets;
}

// Pick the template (or use the chosen one), the best sheet, the header row and the column mapping.
async function analyse(file, templateKey, overrides) {
  const sheets = await readSheets(file);
  let template = templateKey && templateKey !== 'auto' ? getTemplate(templateKey) : null;
  if (templateKey && templateKey !== 'auto' && !template) throw new HttpError(400, 'Unknown template');

  let ranked;
  let sheet;
  if (template) {
    const scored = sheets.map(s => {
      const hr = detectHeaderRow(template, s.table);
      const score = mapColumns(template, (s.table[hr] || []).map(v => String(v ?? ''))).reduce((n, m) => n + m.score, 0);
      return { s, score };
    }).sort((a, b) => b.score - a.score);
    sheet = scored[0].s;
    ranked = rankTemplates(sheet.table);
  } else {
    const candidates = sheets.map(s => ({ s, ranked: rankTemplates(s.table) })).sort((a, b) => b.ranked[0].score - a.ranked[0].score);
    sheet = candidates[0].s;
    ranked = candidates[0].ranked;
    template = getTemplate(ranked[0].key);
  }

  const headerRow = detectHeaderRow(template, sheet.table);
  const sourceHeaders = (sheet.table[headerRow] || []).map(v => String(v ?? '').trim());
  const mapping = mapColumns(template, sourceHeaders, overrides);
  const converted = convertTable(template, sheet.table, headerRow, mapping);
  return { template, ranked, sheetName: sheet.name, headerRow, sourceHeaders, mapping, converted };
}

function readOverrides(raw) {
  if (!raw) return {};
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid column mapping'); } }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new HttpError(400, 'Invalid column mapping');
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === null || v === '' ? null : Number(v);
  return out;
}

// ---------- writing ----------

const display = v => (v instanceof Date ? formatDate(v) : v ?? '');

function buildWorkbook(template, rows, notes) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'XTPL TaskManager';
  wb.created = new Date();
  const ws = wb.addWorksheet(template.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = template.columns;
  const lastRow = Math.max(rows.length, BLANK_ROWS) + 1;
  const thin = { style: 'thin', color: { argb: 'FFD0D7E2' } };

  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width || 16; });
  const head = ws.addRow(cols.map(c => c.header));
  head.height = 24;
  head.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { top: thin, left: thin, bottom: thin, right: thin };
  });

  for (let r = 0; r < lastRow - 1; r++) {
    const data = rows[r];
    const row = ws.addRow(cols.map(c => (data ? data.values[c.header] ?? null : null)));
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
      cell.alignment = { vertical: 'top', wrapText: c.type === 'text', horizontal: c.type === 'int' || c.type === 'serial' ? 'center' : 'left' };
      if (c.type === 'date') cell.numFmt = 'dd-mm-yyyy';
      else if (c.type === 'phone') cell.numFmt = '@';
      else if (c.type === 'int' || c.type === 'serial') cell.numFmt = '0';
      if (c.options) {
        cell.dataValidation = {
          type: 'list', allowBlank: true, formulae: [`"${c.options.join(',')}"`],
          showErrorMessage: true, errorStyle: 'warning', errorTitle: c.header, error: `Standard values: ${c.options.join(', ')}`,
        };
      }
    });
    // Flag every cell that needs a human look, and say why in a cell note.
    for (const w of data?.warnings || []) {
      const i = cols.findIndex(c => c.header === w.column);
      const cell = row.getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
      cell.note = w.message;
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  if (notes) {
    const ns = wb.addWorksheet('Import notes');
    ns.getColumn(1).width = 26; ns.getColumn(2).width = 30; ns.getColumn(3).width = 22; ns.getColumn(4).width = 28; ns.getColumn(5).width = 48;
    const bold = row => { row.font = { bold: true }; return row; };
    bold(ns.addRow(['Source file', notes.fileName]));
    bold(ns.addRow(['Sheet', notes.sheetName]));
    bold(ns.addRow(['Template', template.name]));
    bold(ns.addRow(['Rows imported', rows.length]));
    bold(ns.addRow(['Empty rows skipped', notes.skipped]));
    if (notes.truncated) bold(ns.addRow(['Row limit', `Only the first ${MAX_ROWS} rows were imported`]));
    ns.addRow([]);
    const h1 = bold(ns.addRow(['Template column', 'Taken from your column']));
    h1.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; });
    for (const m of notes.mapping) ns.addRow([m.header, m.type === 'serial' ? '(numbered automatically)' : (m.sourceHeader || '(left empty)')]);
    const issues = rows.flatMap((r, i) => r.warnings.map(w => [i + 2, r.sourceRow, w.column, w.value, w.message]));
    ns.addRow([]);
    const h2 = bold(ns.addRow(['Check these cells', 'Row in this sheet', 'Row in your file', 'Column', 'Value / issue']));
    h2.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; });
    if (!issues.length) ns.addRow(['Nothing to check: every value matched the standard format.']);
    for (const [outRow, srcRow, column, value, message] of issues) ns.addRow(['', outRow, srcRow, column, `${value} - ${message}`]);
  }
  return wb;
}

// ---------- routes ----------

const router = Router();
router.use(requireAuth);

router.get('/templates', (_req, res) => {
  res.json(TRACKER_TEMPLATES.map(t => ({
    key: t.key, name: t.name, project: t.project, description: t.description,
    columns: t.columns.map(c => ({ header: c.header, type: c.type, options: c.options || null })),
  })));
});

router.get('/templates/:key/download', wrap(async (req, res) => {
  const template = getTemplate(req.params.key);
  if (!template) throw new HttpError(404, 'Template not found');
  const buffer = Buffer.from(await buildWorkbook(template, [], null).xlsx.writeBuffer());
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', attachmentHeader(`${template.key}-template.xlsx`));
  res.send(buffer);
}));

// Step 1 of "Upload your document": read the file, pick the template, map the columns, show a preview. Nothing is stored.
router.post('/preview', handleUpload, wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload');
  const a = await analyse(req.file, req.body?.template || 'auto', readOverrides(req.body?.mapping));
  const { rows, skipped, truncated } = a.converted;
  res.json({
    template: a.template.key,
    templates: a.ranked,
    confident: a.mapping.some(m => m.sourceIndex !== null && m.type !== 'serial'),
    sheetName: a.sheetName,
    headerRow: a.headerRow + 1,
    sourceHeaders: a.sourceHeaders,
    mapping: a.mapping,
    totalRows: rows.length,
    skippedRows: skipped,
    truncated,
    rowsWithIssues: rows.filter(r => r.warnings.length).length,
    preview: rows.slice(0, 10).map(r => ({
      values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, display(v)])),
      warnings: r.warnings,
    })),
  });
}));

// Step 2 (or manual entry): produce the filled Excel template. Optionally keep a copy in Documents.
router.post('/convert', handleUpload, wrap(async (req, res) => {
  let template; let rows; let notes = null; let baseName;
  if (req.file) {
    const a = await analyse(req.file, req.body?.template || 'auto', readOverrides(req.body?.mapping));
    template = a.template;
    rows = a.converted.rows;
    baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));
    notes = { fileName: req.file.originalname, sheetName: a.sheetName, skipped: a.converted.skipped, truncated: a.converted.truncated, mapping: a.mapping };
  } else {
    template = getTemplate(req.body?.template);
    if (!template) throw new HttpError(400, 'Choose a template');
    rows = convertManual(template, req.body?.rows).rows;
    baseName = template.key;
  }
  if (!rows.length) throw new HttpError(422, 'There are no data rows to put into the template.');

  const buffer = Buffer.from(await buildWorkbook(template, rows, notes).xlsx.writeBuffer());
  const day = new Date().toISOString().slice(0, 10);
  const safeBase = baseName.replace(/[^a-zA-Z0-9._ -]+/g, '_').slice(0, 60) || template.key;
  const fileName = req.file ? `${safeBase}-${template.key}.xlsx` : `${template.key}-${day}.xlsx`;

  if (String(req.body?.save) === 'true') {
    const stored = safeStoredName(fileName);
    await fs.writeFile(path.join(UPLOAD_DIR, stored), buffer);
    const doc = {
      id: `d${Date.now()}${Math.floor(Math.random() * 100000)}`,
      title: `${template.name} (${day})`,
      description: 'Created with Tracker.',
      category: 'Report',
      project: template.project,
      taskId: '',
      taskTitle: '',
      visibility: 'private',
      file: { name: fileName, stored, mime: XLSX_MIME, size: buffer.length },
      uploadedBy: req.user.id,
      uploadedByName: req.user.name,
      uploadedAt: new Date().toISOString(),
      downloads: 0,
    };
    await serialize(async () => {
      const docs = await loadDocuments();
      docs.unshift(doc);
      await saveDocuments(docs);
    });
    res.setHeader('X-Document-Id', doc.id);
  }
  res.setHeader('X-Tracker-Rows', String(rows.length));
  res.setHeader('X-Tracker-Issues', String(rows.filter(r => r.warnings.length).length));
  res.setHeader('Access-Control-Expose-Headers', 'X-Document-Id, X-Tracker-Rows, X-Tracker-Issues, Content-Disposition');
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', attachmentHeader(fileName));
  res.send(buffer);
}));

export default router;
