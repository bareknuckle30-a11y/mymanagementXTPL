import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, FolderOpen, Globe, Link2, Lock, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { apiFetch, downloadApiFile, downloadDocument, readJson } from './api.js';

const CATEGORIES = ['Template', 'Guide / SOP', 'Report', 'Collateral', 'Other'];
const ACCEPT = '.xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.doc,.docx,.ppt,.pptx,.txt,.zip,.rar,.7z,.mp4,.mov,.mp3';
const MAX_MB = 15;

const ICONS = {
  spreadsheet: [FileSpreadsheet, ['xlsx', 'xls', 'csv']],
  image: [FileImage, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']],
  archive: [FileArchive, ['zip', 'rar', '7z']],
  video: [FileVideo, ['mp4', 'mov']],
  audio: [FileAudio, ['mp3']],
  text: [FileText, ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt']],
};

function fileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  const hit = Object.entries(ICONS).find(([, [, list]]) => list.includes(ext));
  return hit ? { kind: hit[0], Icon: hit[1][0], ext } : { kind: 'other', Icon: File, ext };
}

function size(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function blank(isAdmin) {
  return { title: '', description: '', category: 'Report', project: '', taskId: '', visibility: isAdmin ? 'everyone' : 'private' };
}

export default function DocumentsPage({ user, isAdmin, tasks, projects, notify }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('library');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('All categories');
  const [project, setProject] = useState('All projects');
  const [dialog, setDialog] = useState(null); // null | { mode: 'upload' | 'edit', doc? }
  const [form, setForm] = useState(blank(isAdmin));
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const load = async () => {
    try {
      const res = await apiFetch('/documents');
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error);
      setDocs(data.documents || []);
    } catch {
      notify('Could not load documents');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = e => { if (e.key === 'Escape') setDialog(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  const openUpload = (picked = []) => { setForm(blank(isAdmin)); setFiles(picked); setDialog({ mode: 'upload' }); };
  const openEdit = doc => {
    setForm({ title: doc.title, description: doc.description || '', category: doc.category, project: doc.project || '', taskId: doc.taskId || '', visibility: doc.visibility });
    setDialog({ mode: 'edit', doc });
  };

  const addFiles = list => {
    const picked = [...list];
    const tooBig = picked.find(f => f.size > MAX_MB * 1024 * 1024);
    if (tooBig) { notify(`${tooBig.name} is over ${MAX_MB} MB`); return; }
    setFiles(prev => [...prev, ...picked].slice(0, 10));
  };

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      if (dialog.mode === 'edit') {
        const res = await apiFetch(`/documents/${dialog.doc.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: form.title, description: form.description, category: form.category, project: form.project, ...(isAdmin ? { visibility: form.visibility } : {}) }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || 'Could not save changes');
        setDocs(prev => prev.map(d => d.id === data.id ? data : d));
        notify('Document updated');
      } else {
        if (!files.length) throw new Error('Choose at least one file');
        const fd = new FormData();
        files.forEach(f => fd.append('files', f));
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        const res = await apiFetch('/documents', { method: 'POST', body: fd });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || 'Could not upload');
        setDocs(prev => [...data, ...prev]);
        notify(`${data.length} file${data.length > 1 ? 's' : ''} uploaded`);
        setTab('library');
      }
      setDialog(null);
    } catch (err) {
      notify(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async doc => {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    const res = await apiFetch(`/documents/${doc.id}`, { method: 'DELETE' });
    if (!res.ok) return notify((await readJson(res)).error || 'Could not delete');
    setDocs(prev => prev.filter(d => d.id !== doc.id));
    notify('Document deleted');
  };

  const download = async doc => {
    try {
      await downloadDocument(doc.id, doc.file.name);
      setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, downloads: (d.downloads || 0) + 1 } : d));
    } catch (err) {
      notify(err.message);
    }
  };

  const taskFiles = useMemo(() => tasks
    .flatMap(t => (t.files || []).map(f => ({ ...f, task: t })))
    .sort((a, b) => String(b.task.submittedAt).localeCompare(String(a.task.submittedAt))), [tasks]);

  const needle = q.trim().toLowerCase();
  const shownDocs = docs.filter(d =>
    (category === 'All categories' || d.category === category)
    && (project === 'All projects' || d.project === project)
    && (!needle || `${d.title} ${d.description} ${d.file.name} ${d.taskTitle} ${d.uploadedByName}`.toLowerCase().includes(needle)));
  const shownTaskFiles = taskFiles.filter(f =>
    (project === 'All projects' || f.task.project === project)
    && (!needle || `${f.name} ${f.task.title}`.toLowerCase().includes(needle)));

  const totalBytes = docs.reduce((n, d) => n + (d.file?.size || 0), 0);
  const mine = docs.filter(d => d.uploadedBy === user.id).length;
  const linkable = tasks.filter(t => form.project === '' || t.project === form.project);

  const dropProps = {
    onDragEnter: e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth.current += 1; setDragging(true); } },
    onDragLeave: () => { dragDepth.current = Math.max(dragDepth.current - 1, 0); if (!dragDepth.current) setDragging(false); },
    onDragOver: e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); },
    onDrop: e => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer.files?.length && !dialog) {
        const picked = [...e.dataTransfer.files];
        if (picked.some(f => f.size > MAX_MB * 1024 * 1024)) return notify(`Files must be ${MAX_MB} MB or smaller`);
        openUpload(picked.slice(0, 10));
      }
    },
  };

  return (
    <>
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> FILES</div>
          <h1>Documents</h1>
          <p className="subtitle">{isAdmin
            ? 'Publish templates and guides for the team, and see every file submitted on tasks.'
            : 'Download the templates you need for your tasks, and upload your own reports for admins.'}</p>
        </div>
        <button className="primary-btn" onClick={() => openUpload()}><Plus size={17} /> Upload document</button>
      </section>

      <section className="doc-stats">
        <div className="doc-stat glass-panel"><FolderOpen size={17} /><div><strong>{docs.length}</strong><span>In library</span></div></div>
        <div className="doc-stat glass-panel"><Link2 size={17} /><div><strong>{taskFiles.length}</strong><span>Files on tasks</span></div></div>
        <div className="doc-stat glass-panel"><Upload size={17} /><div><strong>{mine}</strong><span>{isAdmin ? 'Uploaded by you' : 'Your uploads'}</span></div></div>
        <div className="doc-stat glass-panel"><Download size={17} /><div><strong>{size(totalBytes)}</strong><span>Library size</span></div></div>
      </section>

      <section className={`panel doc-panel ${dragging ? 'is-dragging' : ''}`} {...dropProps}>
        <div className="panel-heading task-heading">
          <div className="doc-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'chosen' : ''} onClick={() => setTab('library')}>Library <em>{docs.length}</em></button>
            <button role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'chosen' : ''} onClick={() => setTab('tasks')}>Task submissions <em>{taskFiles.length}</em></button>
          </div>
          <div className="heading-actions">
            <div className="search-box"><Search size={15} /><input placeholder="Search files..." value={q} onChange={e => setQ(e.target.value)} /></div>
            {tab === 'library' && (
              <select className="doc-select" value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
                <option>All categories</option>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            )}
            <select className="doc-select" value={project} onChange={e => setProject(e.target.value)} aria-label="Project">
              <option>All projects</option>
              {projects.map(p => <option key={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {dragging && <div className="doc-drop-hint"><Upload size={22} /> Drop files to upload (max {MAX_MB} MB each)</div>}

        {tab === 'library' && (
          loading ? <p className="empty-inline doc-pad">Loading documents…</p>
            : shownDocs.length === 0 ? (
              <div className="doc-empty">
                <div className="empty-illustration"><FolderOpen size={26} /></div>
                <h2>{docs.length ? 'No documents match your filters' : 'No documents yet'}</h2>
                <p>{docs.length ? 'Try a different search or category.' : 'Upload a template, guide or report. You can also drag files onto this page.'}</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="task-table doc-table">
                  <thead><tr><th>Document</th><th>Category</th><th>Project / task</th><th>Uploaded</th><th>Access</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {shownDocs.map(d => {
                      const { Icon, kind } = fileKind(d.file.name);
                      return (
                        <tr key={d.id}>
                          <td>
                            <div className="doc-name">
                              <span className={`doc-icon ${kind}`}><Icon size={17} /></span>
                              <div>
                                <strong>{d.title}</strong>
                                <small>{d.file.name} · {size(d.file.size)}{d.downloads ? ` · ${d.downloads} download${d.downloads > 1 ? 's' : ''}` : ''}</small>
                                {d.description && <p>{d.description}</p>}
                              </div>
                            </div>
                          </td>
                          <td><span className="doc-cat">{d.category}</span></td>
                          <td>
                            <div className="doc-meta"><span>{d.project || '-'}</span>{d.taskTitle && <small title={d.taskTitle}><Link2 size={11} /> {d.taskTitle}</small>}</div>
                          </td>
                          <td><div className="doc-meta"><span>{d.uploadedByName}</span><small>{when(d.uploadedAt)}</small></div></td>
                          <td>{d.visibility === 'everyone'
                            ? <span className="doc-vis open" title="Visible to the whole team"><Globe size={12} /> Everyone</span>
                            : <span className="doc-vis" title={d.uploadedBy === user.id ? 'Visible to you and admins' : 'Visible to the uploader and admins'}><Lock size={12} /> Private</span>}</td>
                          <td>
                            <div className="doc-actions">
                              <button className="secondary-btn doc-dl" onClick={() => download(d)}><Download size={14} /> Download</button>
                              {d.canManage && <button className="icon-btn" title="Edit details" onClick={() => openEdit(d)}><Pencil size={15} /></button>}
                              {d.canManage && <button className="icon-btn danger" title="Delete" onClick={() => remove(d)}><Trash2 size={15} /></button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
        )}

        {tab === 'tasks' && (
          shownTaskFiles.length === 0 ? (
            <div className="doc-empty">
              <div className="empty-illustration"><Upload size={26} /></div>
              <h2>{taskFiles.length ? 'No files match your filters' : 'No task files yet'}</h2>
              <p>Files appear here automatically when work is submitted on a task.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="task-table doc-table">
                <thead><tr><th>File</th><th>Task</th><th>Project</th><th>Status</th><th>Submitted</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {shownTaskFiles.map(f => {
                    const { Icon, kind } = fileKind(f.name);
                    return (
                      <tr key={`${f.task.id}-${f.stored}`}>
                        <td><div className="doc-name"><span className={`doc-icon ${kind}`}><Icon size={17} /></span><div><strong>{f.name}</strong><small>{size(f.size)}</small></div></div></td>
                        <td><div className="doc-meta"><span>{f.task.title}</span>{f.task.assignee && <small>by {f.task.assignee}</small>}</div></td>
                        <td>{f.task.project}</td>
                        <td><span className={`doc-cat st-${f.task.status.replace(/\s/g, '').toLowerCase()}`}>{f.task.status}</span></td>
                        <td>{when(f.task.submittedAt)}</td>
                        <td><div className="doc-actions"><button className="secondary-btn doc-dl" onClick={() => downloadApiFile(f.stored, f.name).catch(() => notify('Could not download file'))}><Download size={14} /> Download</button></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>

      {dialog && (
        <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null); }}>
          <form className="task-modal glass-panel" onSubmit={submit}>
            <div className="modal-top">
              <div>
                <span className="modal-kicker">{dialog.mode === 'edit' ? 'DOCUMENT DETAILS' : 'UPLOAD'}</span>
                <h2>{dialog.mode === 'edit' ? 'Edit document' : 'Upload documents'}</h2>
                <p>{dialog.mode === 'edit' ? dialog.doc.file.name : `Excel, PDF, images and more. Up to ${MAX_MB} MB each.`}</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setDialog(null)}><X size={18} /></button>
            </div>

            {dialog.mode === 'upload' && (
              <div className="file-label">
                <span className="file-drop doc-dropzone">
                  <Upload size={18} />
                  <input type="file" multiple accept={ACCEPT} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
                  <em>{files.length ? 'Add more files' : 'Click to choose, or drop files on the page'}</em>
                </span>
                {files.length > 0 && (
                  <ul className="doc-picked">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`}>
                        <span>{f.name}</span><small>{size(f.size)}</small>
                        <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, k) => k !== i))}><X size={13} /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {(dialog.mode === 'edit' || files.length <= 1) && (
              <label>Title <span className="optional">{dialog.mode === 'edit' ? '' : 'OPTIONAL'}</span>
                <input required={dialog.mode === 'edit'} placeholder="e.g. Daily telecalling report, 16 Oct" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              </label>
            )}
            <label>Description <span className="optional">OPTIONAL</span>
              <textarea rows="2" placeholder="What is this file and when should it be used?" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="form-row">
              <label>Category
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
              </label>
              <label>Project
                <select value={form.project} onChange={e => setForm({ ...form, project: e.target.value, taskId: '' })}>
                  <option value="">No project</option>
                  {projects.map(p => <option key={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            {dialog.mode === 'upload' && (
              <label>Link to a task <span className="optional">OPTIONAL</span>
                <select value={form.taskId} onChange={e => setForm({ ...form, taskId: e.target.value })}>
                  <option value="">Not linked to a task</option>
                  {linkable.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </label>
            )}
            {isAdmin ? (
              <label>Who can see it
                <select value={form.visibility} onChange={e => setForm({ ...form, visibility: e.target.value })}>
                  <option value="everyone">Everyone on the team</option>
                  <option value="private">Only me and admins</option>
                </select>
              </label>
            ) : (
              <p className="file-hint"><Lock size={11} /> Your uploads are visible to you and admins. Admins can share them with the whole team.</p>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={() => setDialog(null)}>Cancel</button>
              <button className="primary-btn" type="submit" disabled={busy}><Check size={16} />{busy ? 'Please wait…' : dialog.mode === 'edit' ? 'Save changes' : `Upload${files.length > 1 ? ` ${files.length} files` : ''}`}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
