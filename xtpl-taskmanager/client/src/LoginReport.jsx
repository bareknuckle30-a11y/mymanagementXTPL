import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { apiFetch, readJson, saveBlob } from './api.js';
import { formatDuration, formatStamp, presetRange, rangeToIso, reasonLabel, summarizeByPerson, toCsv } from './attendanceUtils.js';

const PRESETS = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All time']];
const PAGE = 100;

// Admin page: every sign-in with its login timestamp, logout timestamp and time online.
export default function LoginReportPage({ people, notify }) {
  const [preset, setPreset] = useState('today');
  const [range, setRange] = useState(() => presetRange('today'));
  const [userId, setUserId] = useState('');
  const [state, setState] = useState('all'); // all | active | ended
  const [data, setData] = useState({ records: [], onlineUserIds: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const q = new URLSearchParams(rangeToIso(range.from, range.to));
      if (userId) q.set('userId', userId);
      const res = await apiFetch(`/attendance?${q}`);
      const body = await readJson(res);
      if (!res.ok) throw new Error(body.error || 'Could not load the login report');
      setData({ records: body.records || [], onlineUserIds: body.onlineUserIds || [] });
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load the login report');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, userId]);

  useEffect(() => { setShown(PAGE); load(); }, [load]);
  useEffect(() => {
    const refresh = setInterval(() => { if (!document.hidden) load(true); }, 30000);
    const clock = setInterval(() => setNow(Date.now()), 10000);
    return () => { clearInterval(refresh); clearInterval(clock); };
  }, [load]);

  const pickPreset = name => { setPreset(name); setRange(presetRange(name)); };
  const setDate = (key, value) => { setPreset('custom'); setRange(r => ({ ...r, [key]: value })); };

  const records = useMemo(() => data.records.filter(r => state === 'all' || (state === 'active' ? !r.logoutAt : Boolean(r.logoutAt))), [data.records, state]);
  const people_ = useMemo(() => summarizeByPerson(data.records, now), [data.records, now]);
  const online = new Set(data.onlineUserIds);
  const totalSec = people_.reduce((n, p) => n + p.totalSec, 0);
  const durationOf = r => (r.logoutAt ? r.durationSec : Math.max(0, Math.round((now - Date.parse(r.loginAt)) / 1000)));

  const exportCsv = () => {
    if (!records.length) return notify('Nothing to export for these filters');
    const blob = new Blob(['﻿', toCsv(records, now)], { type: 'text/csv;charset=utf-8' });
    saveBlob(new Response(blob),`login-report-${range.from || 'all'}_${range.to || 'now'}.csv`);
  };

  return (
    <div className="adm">
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> ADMIN PANEL</div>
          <h1>Login report</h1>
          <p className="subtitle">The clock starts when someone signs in and stops when they sign out. Each sign-in is listed here with its timestamps.</p>
        </div>
      </section>

      <section className="adm-stats">
        <div className="adm-stat"><span>Signed in now</span><strong>{online.size}</strong><em>{online.size === 1 ? 'person' : 'people'} online</em></div>
        <div className="adm-stat"><span>Sign-ins</span><strong>{data.records.length}</strong><em>in this period</em></div>
        <div className="adm-stat"><span>Hours logged</span><strong>{formatDuration(totalSec)}</strong><em>overlaps counted once</em></div>
        <div className="adm-stat"><span>People</span><strong>{people_.length}</strong><em>signed in this period</em></div>
      </section>

      <section className="panel adm-panel">
        <div className="adm-filters">
          <div className="adm-seg" role="group" aria-label="Period">
            {PRESETS.map(([key, label]) => <button key={key} type="button" className={preset === key ? 'on' : ''} onClick={() => pickPreset(key)}>{label}</button>)}
          </div>
          <label>From<input type="date" value={range.from} max={range.to || undefined} onChange={e => setDate('from', e.target.value)} /></label>
          <label>To<input type="date" value={range.to} min={range.from || undefined} onChange={e => setDate('to', e.target.value)} /></label>
          <label>Person
            <select value={userId} onChange={e => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Show
            <select value={state} onChange={e => setState(e.target.value)}>
              <option value="all">All sign-ins</option>
              <option value="active">Active now</option>
              <option value="ended">Signed out</option>
            </select>
          </label>
          <div className="adm-filter-actions">
            <button type="button" className="secondary-btn" onClick={() => load()} title="Refresh"><RefreshCw size={15} /> Refresh</button>
            <button type="button" className="secondary-btn" onClick={exportCsv}><Download size={15} /> Export CSV</button>
          </div>
        </div>
        {error && <p className="adm-error" role="alert">{error}</p>}
      </section>

      <section className="panel adm-panel">
        <div className="panel-heading"><div><h2>Hours by person</h2><p>Total time signed in, for the period above</p></div></div>
        <div className="table-wrap">
          <table className="task-table">
            <thead><tr><th>Person</th><th>Role</th><th>Sign-ins</th><th>First login</th><th>Last logout</th><th>Time online</th></tr></thead>
            <tbody>
              {people_.map(p => (
                <tr key={p.userId}>
                  <td><div className="adm-person"><span className={`adm-dot ${online.has(p.userId) ? 'on' : ''}`} title={online.has(p.userId) ? 'Signed in now' : 'Signed out'} /><div><strong>{p.name}</strong><small>{p.email}</small></div></div></td>
                  <td><span className={`role-pill ${p.role}`}>{p.role}</span></td>
                  <td>{p.sessions}</td>
                  <td>{formatStamp(p.firstLogin)}</td>
                  <td>{p.active ? <span className="adm-badge live">Active now</span> : formatStamp(p.lastActivity)}</td>
                  <td><strong>{formatDuration(p.totalSec)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && people_.length === 0 && <div className="no-results">No sign-ins in this period.</div>}
        </div>
      </section>

      <section className="panel adm-panel">
        <div className="panel-heading"><div><h2>Sign-in log</h2><p>{records.length} {records.length === 1 ? 'entry' : 'entries'}, newest first. Times are shown in your local time.</p></div></div>
        <div className="table-wrap">
          <table className="task-table">
            <thead><tr><th>Person</th><th>Login</th><th>Logout</th><th>Duration</th><th>Ended by</th><th>Device</th></tr></thead>
            <tbody>
              {records.slice(0, shown).map(r => (
                <tr key={r.id}>
                  <td><div className="adm-person"><div><strong>{r.name}</strong><small>{r.role}</small></div></div></td>
                  <td>{formatStamp(r.loginAt)}{r.resumed && <small className="adm-resumed" title="The page was reopened after a quiet period, so a new entry started">resumed</small>}</td>
                  <td>{r.logoutAt ? formatStamp(r.logoutAt) : <span className="adm-badge live">Active now</span>}</td>
                  <td>{formatDuration(durationOf(r))}</td>
                  <td>{reasonLabel({ ...r, active: !r.logoutAt })}</td>
                  <td>{r.device}{r.ip ? <small className="adm-ip">{r.ip}</small> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && records.length === 0 && <div className="no-results">No sign-ins match these filters.</div>}
          {records.length > shown && <div className="adm-more"><button type="button" className="secondary-btn" onClick={() => setShown(n => n + PAGE)}>Show {Math.min(PAGE, records.length - shown)} more</button></div>}
        </div>
        <p className="adm-footnote">If someone closes the browser without signing out, the entry is closed at their last activity (after about 5 minutes) and marked "Closed (no activity)".</p>
      </section>
    </div>
  );
}
