// Tracker core: no I/O and no dependencies, so it can be tested on its own.
// Templates here use exactly the same column headers as the CSV templates seeded into Documents > Library.

const LEAD_STATUS = ['Hot', 'Warm', 'Cold'];
const CALL_STATUS = ['Connected', 'Busy', 'No Answer'];
const YES_NO = ['Yes', 'No'];

export const TRACKER_TEMPLATES = [
  {
    key: 'lead-tracker',
    name: 'Lead Tracker',
    project: 'Telecalling Reports',
    description: 'Status (Hot / Warm / Cold), call status, next action and daily remarks.',
    columns: [
      { header: 'Sr.no', type: 'serial', width: 8, aliases: ['sr no', 'sr', 's no', 'sno', 'serial', 'serial no', 'serial number', 'sl no', 'no', '#'] },
      { header: 'Client', type: 'text', width: 26, aliases: ['client name', 'company', 'company name', 'customer', 'customer name', 'party', 'party name', 'organisation', 'organization', 'firm'] },
      { header: 'Date', type: 'date', width: 13, aliases: ['call date', 'lead date', 'date of call', 'enquiry date', 'inquiry date'] },
      { header: 'Contact Person', type: 'text', width: 22, aliases: ['contact', 'contact name', 'person', 'name', 'spoc'] },
      { header: 'Phone Number', type: 'phone', width: 16, aliases: ['phone', 'phone no', 'mobile', 'mobile no', 'mobile number', 'contact number', 'contact no', 'cell', 'whatsapp', 'whatsapp number'] },
      { header: 'Type', type: 'text', width: 14, aliases: ['client type', 'customer type', 'category', 'segment'] },
      { header: 'Lead Source', type: 'text', width: 16, aliases: ['source', 'lead from', 'channel', 'enquiry source', 'inquiry source'] },
      { header: 'Model/Inches', type: 'text', width: 16, aliases: ['model', 'inches', 'size', 'screen size', 'product', 'model inches'] },
      { header: 'Location', type: 'text', width: 18, aliases: ['city', 'place', 'area', 'address', 'town'] },
      { header: 'Lead Status', type: 'enum', options: LEAD_STATUS, width: 13, aliases: ['status', 'lead temperature', 'temperature', 'hot cold', 'lead type'] },
      { header: 'Call Status', type: 'enum', options: CALL_STATUS, width: 14, aliases: ['call outcome', 'call result', 'calling status', 'call response'] },
      { header: 'Next Action', type: 'text', width: 24, aliases: ['next step', 'action', 'follow up', 'followup', 'next follow up', 'next follow-up'] },
      { header: 'Remarks', type: 'text', width: 34, aliases: ['remark', 'comments', 'comment', 'notes', 'note', 'feedback'] },
    ],
  },
  {
    key: 'telecall-daily',
    name: 'Daily Telecalling Report',
    project: 'Telecalling Reports',
    description: 'One row per caller per day: calls, connects, interest, follow-ups, demos.',
    columns: [
      { header: 'Date', type: 'date', width: 13, aliases: ['report date', 'day'] },
      { header: 'Caller', type: 'text', width: 20, aliases: ['caller name', 'agent', 'telecaller', 'executive', 'employee', 'name'] },
      { header: 'Calls Made', type: 'int', width: 12, aliases: ['calls', 'total calls', 'no of calls', 'dials', 'dialed', 'calls dialed'] },
      { header: 'Connected', type: 'int', width: 12, aliases: ['calls connected', 'connected calls', 'answered', 'picked', 'picked up'] },
      { header: 'Interested', type: 'int', width: 12, aliases: ['interested leads', 'hot leads', 'leads interested'] },
      { header: 'Follow-ups', type: 'int', width: 12, aliases: ['followups', 'follow ups', 'follow up', 'callbacks', 'call backs'] },
      { header: 'Demos Booked', type: 'int', width: 14, aliases: ['demos', 'demo booked', 'demos scheduled', 'demo scheduled', 'appointments'] },
      { header: 'Remarks', type: 'text', width: 34, aliases: ['remark', 'comments', 'comment', 'notes', 'note'] },
    ],
  },
  {
    key: 'weekly-conversion',
    name: 'Weekly Conversion Report',
    project: 'Telecalling Reports',
    description: 'Lead to call to demo to sale funnel with the main drop-off reason.',
    columns: [
      { header: 'Week Starting', type: 'date', width: 14, aliases: ['week', 'week start', 'week of', 'week starting date', 'start date', 'from date'] },
      { header: 'Leads', type: 'int', width: 10, aliases: ['total leads', 'new leads', 'leads received'] },
      { header: 'Calls', type: 'int', width: 10, aliases: ['total calls', 'calls made', 'no of calls'] },
      { header: 'Connected', type: 'int', width: 12, aliases: ['calls connected', 'connected calls', 'answered'] },
      { header: 'Demos', type: 'int', width: 10, aliases: ['demos done', 'demos conducted', 'demo'] },
      { header: 'Quotations Sent', type: 'int', width: 16, aliases: ['quotations', 'quotation', 'quotation sent', 'quotes', 'quotes sent'] },
      { header: 'Sales Closed', type: 'int', width: 14, aliases: ['sales', 'closed', 'deals closed', 'conversions', 'orders', 'won'] },
      { header: 'Main Drop-off Reason', type: 'text', width: 30, aliases: ['drop off reason', 'dropoff reason', 'drop off', 'dropoff', 'lost reason', 'reason'] },
    ],
  },
  {
    key: 'demo-log',
    name: 'Demo Session Log',
    project: 'Training & Demo Sessions',
    description: 'Who attended, where the lead came from, whether it converted, training given.',
    columns: [
      { header: 'Sl. No.', type: 'serial', width: 8, aliases: ['sl no', 'sr no', 'sr', 's no', 'sno', 'serial', 'serial no', 'no', '#'] },
      { header: 'Date', type: 'date', width: 13, aliases: ['demo date', 'session date'] },
      { header: 'Client Name', type: 'text', width: 26, aliases: ['client', 'customer', 'customer name', 'party', 'attendee', 'name', 'company'] },
      { header: 'Source', type: 'text', width: 16, aliases: ['lead source', 'channel', 'lead from'] },
      { header: 'Converted', type: 'yesno', options: YES_NO, width: 12, aliases: ['conversion', 'converted yes no', 'result', 'outcome', 'status', 'closed'] },
      { header: 'Training Given', type: 'text', width: 34, aliases: ['training', 'training details', 'topics', 'topics covered', 'demo given', 'notes'] },
    ],
  },
];

export const MAX_ROWS = 5000;

export const getTemplate = key => TRACKER_TEMPLATES.find(t => t.key === key) || null;

export const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, '');

const isEmpty = v => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

// ---------- header matching ----------

const words = v => String(v ?? '').toLowerCase().split(/[^a-z0-9#]+/).filter(Boolean).join(' ');
const hasPhrase = (haystack, needle) => { const n = words(needle); return n !== '' && ` ${words(haystack)} `.includes(` ${n} `); };

// How well one source header fits one template column: 0 means no match.
function matchScore(col, sourceHeader) {
  const s = norm(sourceHeader);
  if (!s) return 0;
  const h = norm(col.header);
  if (s === h) return 100;
  if (col.aliases.some(a => norm(a) === s)) return 90;
  // Looser containment, only for headers long enough not to match by accident ("no" inside "phone no").
  // The shorter text must appear as whole word(s), so "Candidate" or "Last Update" never match "Date".
  if (s.length >= 4 && h.length >= 4 && (hasPhrase(sourceHeader, col.header) || hasPhrase(col.header, sourceHeader))) return 60;
  if (s.length >= 5 && col.aliases.some(a => { const n = norm(a); return n.length >= 5 && (hasPhrase(sourceHeader, a) || hasPhrase(a, sourceHeader)); })) return 50;
  return 0;
}

// One-to-one mapping of template columns to source columns, strongest matches first.
export function mapColumns(template, sourceHeaders, overrides = {}) {
  const pairs = [];
  template.columns.forEach((col, ci) => {
    sourceHeaders.forEach((sh, si) => {
      const score = matchScore(col, sh);
      if (score >= 50) pairs.push({ ci, si, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.ci - b.ci || a.si - b.si);
  const colTaken = new Set();
  const srcTaken = new Set();
  const chosen = new Map();

  // Manual choices from the person win over automatic ones. A negative or null index means "leave empty".
  for (const [header, si] of Object.entries(overrides || {})) {
    const ci = template.columns.findIndex(c => c.header === header);
    if (ci < 0) continue;
    colTaken.add(ci);
    if (Number.isInteger(si) && si >= 0 && si < sourceHeaders.length && !srcTaken.has(si)) {
      srcTaken.add(si);
      chosen.set(ci, { si, score: 100, manual: true });
    }
  }
  for (const p of pairs) {
    if (colTaken.has(p.ci) || srcTaken.has(p.si)) continue;
    colTaken.add(p.ci);
    srcTaken.add(p.si);
    chosen.set(p.ci, { si: p.si, score: p.score, manual: false });
  }
  return template.columns.map((col, ci) => {
    const c = chosen.get(ci);
    return {
      header: col.header,
      type: col.type,
      sourceIndex: c ? c.si : null,
      sourceHeader: c ? String(sourceHeaders[c.si] ?? '') : '',
      score: c ? c.score : 0,
      manual: c ? c.manual : false,
    };
  });
}

const mappedScore = mapping => mapping.reduce((n, m) => n + m.score, 0);

// Find the row that holds the headers (reports often start with a title or blank lines).
export function detectHeaderRow(template, table) {
  let best = { index: -1, score: 0 };
  const limit = Math.min(table.length, 25);
  for (let i = 0; i < limit; i++) {
    const row = table[i] || [];
    if (row.filter(v => !isEmpty(v)).length < 2) continue;
    const score = mappedScore(mapColumns(template, row.map(v => String(v ?? ''))));
    if (score > best.score) best = { index: i, score };
  }
  if (best.index >= 0) return best.index;
  const firstFilled = table.findIndex(r => (r || []).some(v => !isEmpty(v)));
  return firstFilled < 0 ? 0 : firstFilled;
}

// Rank templates against an uploaded table so the right one can be picked automatically.
export function rankTemplates(table) {
  return TRACKER_TEMPLATES.map(t => {
    const headerRow = detectHeaderRow(t, table);
    const mapping = mapColumns(t, (table[headerRow] || []).map(v => String(v ?? '')));
    const matched = mapping.filter(m => m.sourceIndex !== null && m.type !== 'serial').length;
    const considered = t.columns.filter(c => c.type !== 'serial').length;
    return { key: t.key, name: t.name, matched, of: considered, score: mappedScore(mapping) };
  }).sort((a, b) => b.score - a.score);
}

// ---------- value cleaning ----------

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function utcDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null;
}

// Day-first, as used in India. Returns a UTC midnight Date or null.
export function parseDate(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return utcDate(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // not a plausible Excel date serial
    const ms = Math.round((Math.floor(v) - 25569) * 86400000);
    return parseDate(new Date(ms));
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return utcDate(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    let d = +m[1]; let mo = +m[2]; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return utcDate(y, mo - 1, d);
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s,.-]+([A-Za-z]{3,9})[\s,.-]+(\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    return utcDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
  }
  return null;
}

export function formatDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

function cleanPhone(v) {
  let raw = typeof v === 'number' ? String(Math.round(v)) : String(v).trim();
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(raw)) raw = String(Math.round(Number(raw)));
  // Two numbers in one cell ("98xxxxxx01 / 97xxxxxx02") cannot be placed in a single field: keep and flag.
  if (/\d{8,}\D+\d{8,}/.test(raw)) return { value: raw, warning: 'More than one phone number in the cell' };
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return { value: digits };
  return { value: raw, warning: 'Phone number should have 10 digits' };
}

function cleanEnum(col, v) {
  const n = norm(v);
  if (col.header === 'Lead Status') {
    for (const o of LEAD_STATUS) if (n.startsWith(norm(o))) return { value: o };
  } else if (col.header === 'Call Status') {
    if (['connected', 'answered', 'picked', 'pickedup', 'received', 'spoke', 'talked'].includes(n)) return { value: 'Connected' };
    if (['busy', 'linebusy'].includes(n)) return { value: 'Busy' };
    if (['noanswer', 'notanswering', 'notanswered', 'unanswered', 'noresponse', 'notpicked', 'rnr', 'ringing', 'noreply'].includes(n)) return { value: 'No Answer' };
  } else if (col.type === 'yesno') {
    if (['yes', 'y', 'true', '1', 'converted', 'won', 'closed', 'done'].includes(n)) return { value: 'Yes' };
    if (['no', 'n', 'false', '0', 'notconverted', 'lost'].includes(n)) return { value: 'No' };
  }
  return { value: String(v).trim(), warning: `Not a standard value (${col.options.join(' / ')})` };
}

export function cleanValue(col, raw) {
  if (isEmpty(raw)) return { value: null };
  switch (col.type) {
    case 'date': {
      const d = parseDate(raw);
      return d ? { value: d } : { value: String(raw).trim(), warning: 'Date not recognised (use DD-MM-YYYY)' };
    }
    case 'phone': return cleanPhone(raw);
    case 'int': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
      if (Number.isFinite(n) && n >= 0) return { value: Math.round(n) };
      return { value: String(raw).trim(), warning: 'Expected a whole number' };
    }
    case 'enum':
    case 'yesno': return cleanEnum(col, raw);
    case 'serial': {
      const n = Number(raw);
      return Number.isFinite(n) ? { value: n } : { value: null };
    }
    default: return { value: String(raw).replace(/\s+/g, ' ').trim().slice(0, 500) };
  }
}

// Turn a source table (array of rows) into template rows.
// table: raw cell values, headerRow: index of the header row, mapping: result of mapColumns.
export function convertTable(template, table, headerRow, mapping) {
  const out = [];
  let skipped = 0;
  for (let r = headerRow + 1; r < table.length; r++) {
    const src = table[r] || [];
    const hasData = mapping.some(m => m.sourceIndex !== null && m.type !== 'serial' && !isEmpty(src[m.sourceIndex]));
    if (!hasData) { skipped += 1; continue; }
    if (out.length >= MAX_ROWS) return { rows: out, skipped, truncated: true };
    out.push(buildRow(template, mapping.map(m => (m.sourceIndex === null ? null : src[m.sourceIndex])), out.length + 1, r + 1));
  }
  return { rows: out, skipped, truncated: false };
}

// Rows typed by hand: values arrive as { header: value }.
export function convertManual(template, rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const vals = template.columns.map(c => (row && typeof row === 'object' ? row[c.header] : null));
    if (!vals.some((v, i) => template.columns[i].type !== 'serial' && !isEmpty(v))) continue;
    if (out.length >= MAX_ROWS) return { rows: out, skipped: 0, truncated: true };
    out.push(buildRow(template, vals, out.length + 1, out.length + 1));
  }
  return { rows: out, skipped: 0, truncated: false };
}

function buildRow(template, rawValues, serial, sourceRow) {
  const values = {};
  const warnings = [];
  template.columns.forEach((col, i) => {
    if (col.type === 'serial') { values[col.header] = serial; return; } // always renumbered 1..n
    const { value, warning } = cleanValue(col, rawValues[i]);
    values[col.header] = value;
    if (warning) warnings.push({ column: col.header, message: warning, value: String(value ?? '') });
  });
  return { values, warnings, sourceRow };
}

// ---------- CSV ----------

export function parseCsv(text) {
  const src = String(text).replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
