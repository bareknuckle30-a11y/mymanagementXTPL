import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Plus, Trash2, Upload, X } from 'lucide-react';
import { apiFetch, readJson, saveBlob } from './api.js';

const MAX_MB = 15;
const ACCEPT = '.xlsx,.xlsm,.csv,.xls';
const blankRows = n => Array.from({ length: n }, () => ({}));

export default function TrackerPage({ notify }) {
  const [templates, setTemplates] = useState([]);
  const [mode, setMode] = useState('upload'); // 'upload' | 'manual'
  const [file, setFile] = useState(null);
  const [tpl, setTpl] = useState('auto');      // template chosen for upload ('auto' = detect)
  const [overrides, setOverrides] = useState({});
  const [analysis, setAnalysis] = useState(null);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [manualTpl, setManualTpl] = useState('lead-tracker');
  const [rows, setRows] = useState(blankRows(5));
  const picker = useRef(null);

  useEffect(() => {
    apiFetch('/tracker/templates')
      .then(async res => { if (!res.ok) throw new Error(); setTemplates(await res.json()); })
      .catch(() => notify('Could not load the Tracker templates'));
  }, []);

  const byKey = key => templates.find(t => t.key === key);

  // ----- upload flow -----
  const preview = async (f, templateKey, map) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('template', templateKey);
      fd.append('mapping', JSON.stringify(map));
      const res = await apiFetch('/tracker/preview', { method: 'POST', body: fd });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Could not read the file');
      setAnalysis(data);
    } catch (err) {
      notify(err.message);
      setAnalysis(null);
      setFile(null);
    } finally {
      setBusy(false);
    }
  };

  const pickFile = f => {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) return notify(`${f.name} is over ${MAX_MB} MB`);
    setFile(f); setOverrides({}); setTpl('auto'); setAnalysis(null);
    preview(f, 'auto', {});
  };

  const changeTemplate = key => { setTpl(key); setOverrides({}); preview(file, key, {}); };

  const changeMapping = (header, value) => {
    const next = { ...overrides, [header]: value === '' ? null : Number(value) };
    setOverrides(next);
    preview(file, analysis.template, next);
  };

  const reset = () => { setFile(null); setAnalysis(null); setOverrides({}); setTpl('auto'); };

  const convert = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('template', analysis.template);
      fd.append('mapping', JSON.stringify(overrides));
      fd.append('save', String(save));
      const res = await apiFetch('/tracker/convert', { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await readJson(res)).error || 'Could not create the Excel file');
      const base = file.name.replace(/\.[^.]+$/, '');
      await saveBlob(res, `${base}-${analysis.template}.xlsx`);
      const issues = Number(res.headers.get('X-Tracker-Issues') || 0);
      notify(`Excel file downloaded${save ? ' and saved to Documents' : ''}${issues ? `. ${issues} row${issues > 1 ? 's' : ''} need a quick check (highlighted yellow)` : ''}`);
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ----- manual flow -----
  const manualTemplate = byKey(manualTpl);
  const setCell = (i, header, value) => setRows(prev => prev.map((r, k) => (k === i ? { ...r, [header]: value } : r)));
  const filled = rows.filter(r => Object.values(r).some(v => String(v ?? '').trim() !== '')).length;

  const changeManualTemplate = key => {
    if (filled && !window.confirm('Switching template clears the rows you typed. Continue?')) return;
    setManualTpl(key); setRows(blankRows(5));
  };

  const convertManual = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/tracker/convert', { method: 'POST', body: JSON.stringify({ template: manualTpl, rows, save }) });
      if (!res.ok) throw new Error((await readJson(res)).error || 'Could not create the Excel file');
      await saveBlob(res, `${manualTpl}-${new Date().toISOString().slice(0, 10)}.xlsx`);
      notify(`Excel file downloaded${save ? ' and saved to Documents' : ''}`);
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadBlank = async key => {
    try {
      const res = await apiFetch(`/tracker/templates/${encodeURIComponent(key)}/download`);
      if (!res.ok) throw new Error((await readJson(res)).error || 'Could not download the template');
      await saveBlob(res, `${key}-template.xlsx`);
    } catch (err) {
      notify(err.message);
    }
  };

  const activeKey = mode === 'upload' ? (analysis?.template || null) : manualTpl;
  const detected = analysis && byKey(analysis.template);

  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> SPREADSHEETS</div>
          <h1>Tracker</h1>
          <p className="subtitle">Turn any sheet into the standard XTPL Excel template, or fill the template here. No copy and paste.</p>
        </div>
        {activeKey && <button className="secondary-btn" onClick={() => downloadBlank(activeKey)}><FileSpreadsheet size={16} /> Blank template (.xlsx)</button>}
      </section>

      <section className="panel tracker-panel">
        <div className="panel-heading task-heading">
          <div className="doc-tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'upload'} className={mode === 'upload' ? 'chosen' : ''} onClick={() => setMode('upload')}><Upload size={14} /> Upload your document</button>
            <button role="tab" aria-selected={mode === 'manual'} className={mode === 'manual' ? 'chosen' : ''} onClick={() => setMode('manual')}><FileSpreadsheet size={14} /> Enter manually</button>
          </div>
          {mode === 'manual' && (
            <select className="doc-select" value={manualTpl} onChange={e => changeManualTemplate(e.target.value)} aria-label="Template">
              {templates.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
          )}
        </div>

        {mode === 'upload' && !analysis && (
          <div className="tk-body">
            <div
              className={`tk-drop ${dragging ? 'over' : ''} ${busy ? 'busy' : ''}`}
              onClick={() => !busy && picker.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) pickFile(e.dataTransfer.files?.[0]); }}
              role="button" tabIndex={0}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); picker.current?.click(); } }}
            >
              <Upload size={28} />
              <strong>{busy ? `Reading ${file?.name || 'file'}…` : 'Drop your Excel or CSV file here'}</strong>
              <span>{busy ? 'Matching your columns to the template' : `or click to choose. .xlsx or .csv, up to ${MAX_MB} MB.`}</span>
              <input ref={picker} type="file" accept={ACCEPT} hidden onChange={e => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            <p className="tk-hint">We find the header row, detect which template fits (Lead Tracker, Daily Telecalling, Weekly Conversion, Demo Log), move each column into place, and tidy dates, phone numbers and Hot / Cold values. You can review everything before downloading.</p>
          </div>
        )}

        {mode === 'upload' && analysis && (
          <div className="tk-body">
            <div className="tk-summary">
              <div className="tk-file"><FileSpreadsheet size={18} /><div><strong>{file?.name}</strong><small>{analysis.sheetName} · header on row {analysis.headerRow}</small></div></div>
              <label className="tk-field">Template
                <select className="doc-select" value={tpl} onChange={e => changeTemplate(e.target.value)} disabled={busy}>
                  <option value="auto">Auto-detect{tpl === 'auto' && detected ? ` (${detected.name})` : ''}</option>
                  {templates.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
                </select>
              </label>
              <button className="icon-btn" title="Choose a different file" onClick={reset}><X size={17} /></button>
            </div>

            {!analysis.confident && (
              <div className="tk-banner warn"><AlertTriangle size={16} /> None of your column names matched this template. Pick the right template above, or choose the columns by hand below.</div>
            )}

            <div className="tk-stats">
              <span><CheckCircle2 size={14} /> {analysis.totalRows} row{analysis.totalRows === 1 ? '' : 's'} ready</span>
              {analysis.rowsWithIssues > 0 && <span className="warn"><AlertTriangle size={14} /> {analysis.rowsWithIssues} need a check</span>}
              {analysis.skippedRows > 0 && <span>{analysis.skippedRows} empty row{analysis.skippedRows === 1 ? '' : 's'} skipped</span>}
              {analysis.truncated && <span className="warn">Only the first 5,000 rows are used</span>}
            </div>

            <h3 className="tk-h">Column mapping</h3>
            <div className="table-wrap">
              <table className="task-table tk-map">
                <thead><tr><th>Template column</th><th>Taken from your column</th><th /></tr></thead>
                <tbody>
                  {analysis.mapping.map(m => (
                    <tr key={m.header}>
                      <td><strong>{m.header}</strong></td>
                      <td>
                        {m.type === 'serial' ? <span className="tk-muted">Numbered automatically</span> : (
                          <select className="doc-select" disabled={busy} value={m.sourceIndex ?? ''} onChange={e => changeMapping(m.header, e.target.value)} aria-label={`Source for ${m.header}`}>
                            <option value="">(leave empty)</option>
                            {analysis.sourceHeaders.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                          </select>
                        )}
                      </td>
                      <td>{m.type !== 'serial' && (m.sourceIndex === null ? <span className="tk-chip none">Empty</span> : m.manual ? <span className="tk-chip">Your choice</span> : <span className="tk-chip ok">Matched</span>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="tk-h">Preview <small>first {analysis.preview.length} of {analysis.totalRows}</small></h3>
            <div className="table-wrap tk-preview">
              <table className="task-table">
                <thead><tr>{analysis.mapping.map(m => <th key={m.header}>{m.header}</th>)}</tr></thead>
                <tbody>
                  {analysis.preview.map((r, i) => (
                    <tr key={i}>
                      {analysis.mapping.map(m => {
                        const w = r.warnings.find(x => x.column === m.header);
                        return <td key={m.header} className={w ? 'tk-warn' : ''} title={w?.message}>{String(r.values[m.header] ?? '')}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {analysis.rowsWithIssues > 0 && <p className="tk-hint">Yellow cells could not be put in the standard format. They are kept exactly as you typed them and listed on the "Import notes" sheet of the Excel file.</p>}

            <div className="tk-actions">
              <label className="tk-check"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} /> Also save a copy to Documents</label>
              <button className="primary-btn" onClick={convert} disabled={busy || analysis.totalRows === 0}><Download size={16} /> {busy ? 'Working…' : 'Download Excel'}</button>
            </div>
          </div>
        )}

        {mode === 'manual' && manualTemplate && (
          <div className="tk-body">
            <p className="tk-hint tk-first">{manualTemplate.description} Type your rows below, then download the filled Excel template.</p>
            <div className="table-wrap tk-grid">
              <table className="task-table">
                <thead><tr><th>#</th>{manualTemplate.columns.filter(c => c.type !== 'serial').map(c => <th key={c.header}>{c.header}</th>)}<th aria-label="Remove" /></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="tk-muted">{i + 1}</td>
                      {manualTemplate.columns.filter(c => c.type !== 'serial').map(c => (
                        <td key={c.header}>
                          {c.options ? (
                            <select value={r[c.header] ?? ''} onChange={e => setCell(i, c.header, e.target.value)} aria-label={c.header}>
                              <option value="" />
                              {c.options.map(o => <option key={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              type={c.type === 'date' ? 'date' : c.type === 'int' ? 'number' : c.type === 'phone' ? 'tel' : 'text'}
                              min={c.type === 'int' ? 0 : undefined}
                              value={r[c.header] ?? ''}
                              onChange={e => setCell(i, c.header, e.target.value)}
                              aria-label={c.header}
                            />
                          )}
                        </td>
                      ))}
                      <td><button className="icon-btn danger" title="Remove row" onClick={() => setRows(prev => prev.length > 1 ? prev.filter((_, k) => k !== i) : blankRows(1))}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tk-actions">
              <button className="secondary-btn" onClick={() => setRows(prev => [...prev, ...blankRows(5)].slice(0, 500))}><Plus size={15} /> Add 5 rows</button>
              <span className="tk-spacer" />
              <label className="tk-check"><input type="checkbox" checked={save} onChange={e => setSave(e.target.checked)} /> Also save a copy to Documents</label>
              <button className="primary-btn" onClick={convertManual} disabled={busy || filled === 0}><Download size={16} /> {busy ? 'Working…' : `Download Excel${filled ? ` (${filled} row${filled > 1 ? 's' : ''})` : ''}`}</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
