import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Camera, Copy, Download, KeyRound, LockKeyhole, QrCode, ScanLine, Trash2, Upload } from 'lucide-react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { apiFetch, readJson } from './api.js';
import { formatStamp } from './attendanceUtils.js';
import { MAX_LABEL, MAX_TEXT_BYTES, QrError, byteLength, decryptPayload, encryptPayload, generateCode, parsePayload } from './qrCrypto.js';

const EXPIRY = [['60', '1 hour'], ['1440', '24 hours'], ['10080', '7 days'], ['43200', '30 days'], ['never', 'No expiry']];
const REVEAL_SECONDS = 60;

async function copy(text, notify, what) {
  try { await navigator.clipboard.writeText(text); notify(`${what} copied`); }
  catch { notify('Copy is blocked in this browser. Select the text and copy it by hand.'); }
}

// ---- reading a QR from a camera frame or an image --------------------------------------------

function readImageData(source, w, h) {
  const canvas = document.createElement('canvas');
  const max = 1600; // keep very large photos fast; dense codes still have plenty of pixels
  const scale = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
}

async function decodeFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const hit = readImageData(bitmap, bitmap.width, bitmap.height);
    return hit?.data || '';
  } finally { bitmap.close?.(); }
}

function CameraScanner({ onFound, onError }) {
  const videoRef = useRef(null);
  useEffect(() => {
    let stopped = false;
    let stream = null;
    let timer = null;
    const video = videoRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      onError('The camera needs a secure page (https:// or localhost). Use "Upload image" instead.');
      return undefined;
    }
    const scan = () => {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const hit = readImageData(video, video.videoWidth, video.videoHeight);
        if (hit?.data) { onFound(hit.data); return; }
      }
      timer = setTimeout(scan, 150);
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(s => {
        if (stopped) { s.getTracks().forEach(t => t.stop()); return null; }
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(() => scan())
      .catch(err => onError(err?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow it in the browser, or use "Upload image".' : 'Could not start the camera. Use "Upload image" instead.'));
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
   
  }, []);
  return (
    <div className="qr-camera">
      <video ref={videoRef} muted playsInline />
      <div className="qr-camera-frame" aria-hidden="true" />
    </div>
  );
}

// ---- page -------------------------------------------------------------------------------------

export default function SecureQRPage({ notify }) {
  const [tab, setTab] = useState('create');
  const [list, setList] = useState([]);
  const loadList = useCallback(async () => {
    try {
      const res = await apiFetch('/qr');
      if (res.ok) setList(await res.json());
    } catch { /* shown as an empty register */ }
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  const act = async (qr, action) => {
    if (action === 'delete' && !window.confirm(`Delete "${qr.label}" from the register? The printed QR will stop working.`)) return;
    if (action === 'revoke' && !window.confirm(`Revoke "${qr.label}"? Nobody will be able to open it any more.`)) return;
    try {
      const res = await apiFetch(action === 'delete' ? `/qr/${qr.id}` : `/qr/${qr.id}/revoke`, { method: action === 'delete' ? 'DELETE' : 'POST' });
      if (!res.ok) return notify((await readJson(res)).error || 'Could not update the QR');
      notify(action === 'delete' ? 'QR deleted' : 'QR revoked');
      loadList();
    } catch { notify('Could not reach the server'); }
  };

  return (
    <div className="adm">
      <section className="welcome-row">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> ADMIN PANEL</div>
          <h1>Secure QR</h1>
          <p className="subtitle">Lock a message inside a QR code. It can only be read with a verification code, and that code is never emailed, texted or stored by this app.</p>
        </div>
      </section>

      <div className="adm-seg adm-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}><QrCode size={15} /> Create</button>
        <button type="button" role="tab" aria-selected={tab === 'open'} className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}><ScanLine size={15} /> Scan &amp; unlock</button>
      </div>

      {tab === 'create' ? <CreatePanel notify={notify} onCreated={loadList} /> : <OpenPanel notify={notify} onResult={loadList} />}

      <section className="panel adm-panel">
        <div className="panel-heading"><div><h2>Issued QR codes</h2><p>The register keeps labels, expiry and open counts only. Messages and codes are never stored.</p></div></div>
        <div className="table-wrap">
          <table className="task-table">
            <thead><tr><th>Label</th><th>Created</th><th>Expires</th><th>Status</th><th>Opened</th><th>Wrong codes</th><th /></tr></thead>
            <tbody>
              {list.map(q => (
                <tr key={q.id}>
                  <td><strong>{q.label}</strong><small className="adm-ip">by {q.createdByName}</small></td>
                  <td>{formatStamp(q.createdAt)}</td>
                  <td>{q.expiresAt ? formatStamp(q.expiresAt) : 'Never'}</td>
                  <td><span className={`adm-badge ${q.status}`}>{q.status}</span></td>
                  <td>{q.opened}{q.lastOpenedAt ? <small className="adm-ip">{formatStamp(q.lastOpenedAt)} · {q.lastOpenedByName}</small> : null}</td>
                  <td>{q.failed}</td>
                  <td className="adm-actions">
                    {q.status === 'active' && <button type="button" className="icon-btn tiny" title="Revoke" aria-label={`Revoke ${q.label}`} onClick={() => act(q, 'revoke')}><Ban size={15} /></button>}
                    <button type="button" className="icon-btn tiny" title="Delete" aria-label={`Delete ${q.label}`} onClick={() => act(q, 'delete')}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <div className="no-results">No QR codes yet. Create one above.</div>}
        </div>
      </section>
    </div>
  );
}

// ---- create -----------------------------------------------------------------------------------

function CreatePanel({ notify, onCreated }) {
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const [expiry, setExpiry] = useState('1440');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { image, code, payload, label, expiresAt } held in memory only
  const bytes = byteLength(text);

  const submit = async e => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!label.trim()) return setError('Give the QR a label so you can find it later.');
    if (!text.trim()) return setError('Write the message to lock inside the QR.');
    if (bytes > MAX_TEXT_BYTES) return setError(`The message is too long for a QR (${bytes} of ${MAX_TEXT_BYTES} bytes).`);
    setBusy(true);
    let registered = null;
    try {
      const res = await apiFetch('/qr', { method: 'POST', body: JSON.stringify({ label: label.trim(), expiresInMinutes: expiry === 'never' ? null : Number(expiry) }) });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body.error || 'Could not register the QR');
      registered = body;
      // The code is made here, used here, and shown once. It is not sent to the server.
      const code = generateCode();
      const payload = await encryptPayload({ id: body.id, code, label: body.label, text: text.trim(), createdAt: body.createdAt, expiresAt: body.expiresAt });
      const image = await QRCode.toDataURL(payload, { errorCorrectionLevel: payload.length > 900 ? 'L' : 'M', margin: 2, scale: 6, color: { dark: '#0b1220', light: '#ffffff' } });
      setResult({ image, code, payload, label: body.label, expiresAt: body.expiresAt });
      setText('');
      onCreated();
    } catch (err) {
      if (registered) apiFetch(`/qr/${registered.id}`, { method: 'DELETE' }).catch(() => {}); // do not leave a QR in the register that was never drawn
      setError(err instanceof QrError || err?.message ? err.message : 'Could not create the QR');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <section className="panel adm-panel adm-result">
        <div className="adm-result-qr">
          <img src={result.image} alt={`Encrypted QR code for ${result.label}`} />
          <a className="secondary-btn" href={result.image} download={`secure-qr-${result.label.replace(/[^\w-]+/g, '_')}.png`}><Download size={15} /> Download PNG</a>
        </div>
        <div className="adm-result-copy">
          <h2>{result.label}</h2>
          <p className="adm-muted">{result.expiresAt ? `Expires ${formatStamp(result.expiresAt)}.` : 'Does not expire.'} Anyone can see this QR, but only someone with the code can read it.</p>
          <div className="adm-code" aria-live="polite">
            <span><KeyRound size={15} /> Verification code</span>
            <strong>{result.code}</strong>
            <button type="button" className="secondary-btn" onClick={() => copy(result.code, notify, 'Code')}><Copy size={15} /> Copy code</button>
          </div>
          <p className="adm-warn"><LockKeyhole size={15} /> Shown only once. It is not stored and not sent by email or SMS. Give it to the person yourself (in person or by phone), separately from the QR. If you lose it, the QR cannot be opened: revoke it and make a new one.</p>
          <div className="adm-btn-row">
            <button type="button" className="secondary-btn" onClick={() => copy(result.payload, notify, 'QR text')}><Copy size={15} /> Copy QR text</button>
            <button type="button" className="primary-btn" onClick={() => setResult(null)}>Done, hide the code</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel adm-panel">
      <form className="adm-form" onSubmit={submit}>
        <label>Label <span className="optional">ONLY ADMINS SEE THIS</span>
          <input value={label} maxLength={MAX_LABEL} onChange={e => setLabel(e.target.value)} placeholder="e.g. Store room access note" />
        </label>
        <label>Message to lock inside the QR
          <textarea rows="4" value={text} onChange={e => setText(e.target.value)} placeholder="Text, a link or instructions" />
          <small className={`adm-count ${bytes > MAX_TEXT_BYTES ? 'over' : ''}`}>{bytes} / {MAX_TEXT_BYTES} bytes (Hindi and emoji use more bytes per character)</small>
        </label>
        <label>Expires after
          <select value={expiry} onChange={e => setExpiry(e.target.value)}>{EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        {error && <p className="adm-error" role="alert">{error}</p>}
        <div className="adm-btn-row">
          <button className="primary-btn" type="submit" disabled={busy}><QrCode size={16} /> {busy ? 'Encrypting…' : 'Generate encrypted QR'}</button>
        </div>
        <p className="adm-muted">The message is encrypted in this browser (AES-256-GCM, key from a random verification code). The server only records that the QR exists.</p>
      </form>
    </section>
  );
}

// ---- scan & unlock ----------------------------------------------------------------------------

function OpenPanel({ notify, onResult }) {
  const [source, setSource] = useState(''); // '' | camera
  const [pasted, setPasted] = useState('');
  const [payload, setPayload] = useState('');
  const [meta, setMeta] = useState(null);   // { id, label, expiresAt } from the register
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(null); // decrypted message, in memory only
  const [left, setLeft] = useState(0);
  const fileRef = useRef(null);

  // Hide the message again after a minute.
  useEffect(() => {
    if (!opened) return undefined;
    const t = setInterval(() => setLeft(n => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(t);
  }, [opened]);
  useEffect(() => { if (opened && left === 0) reset(); }, [left, opened]);

  const reset = () => { setPayload(''); setMeta(null); setCode(''); setOpened(null); setError(''); setPasted(''); setSource(''); };

  const accept = async text => {
    setError(''); setSource('');
    let parsed;
    try { parsed = parsePayload(text); } catch (err) { return setError(err.message); }
    setBusy(true);
    try {
      const res = await apiFetch(`/qr/${parsed.id}`);
      const body = await readJson(res);
      if (!res.ok) return setError(body.error || 'This QR cannot be opened');
      setPayload(text.trim());
      setMeta(body);
    } catch { setError('Could not reach the server to check this QR'); }
    finally { setBusy(false); }
  };

  const onFile = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const text = await decodeFile(file);
      if (!text) return setError('No QR code found in that image. Try a sharper, closer photo or use the camera.');
      accept(text);
    } catch { setError('Could not read that image.'); }
  };

  const unlock = async e => {
    e.preventDefault();
    if (busy || !payload) return;
    setBusy(true); setError('');
    const report = ok => apiFetch(`/qr/${meta.id}/result`, { method: 'POST', body: JSON.stringify({ ok }) }).then(onResult).catch(() => {});
    try {
      const data = await decryptPayload(payload, code);
      if (data.expiresAt && Date.parse(data.expiresAt) <= Date.now()) { setError('This QR has expired.'); return; }
      report(true);
      setLeft(REVEAL_SECONDS); // set together with `opened`, so the auto-hide below never sees a stale 0
      setOpened(data);
      setCode('');
    } catch (err) {
      if (err instanceof QrError && err.code === 'BAD_CODE') { report(false); setError('Wrong verification code, or the QR was altered.'); }
      else setError('Could not unlock this QR.');
    } finally { setBusy(false); }
  };

  if (opened) {
    return (
      <section className="panel adm-panel adm-opened">
        <div className="panel-heading"><div><h2>{opened.label}</h2><p>Created {formatStamp(opened.createdAt)}{opened.expiresAt ? ` · expires ${formatStamp(opened.expiresAt)}` : ''}</p></div><span className="adm-badge active">Hides in {left}s</span></div>
        <pre className="adm-message">{opened.text}</pre>
        <div className="adm-btn-row">
          <button type="button" className="secondary-btn" onClick={() => copy(opened.text, notify, 'Message')}><Copy size={15} /> Copy message</button>
          <button type="button" className="primary-btn" onClick={reset}>Hide message</button>
        </div>
      </section>
    );
  }

  if (payload && meta) {
    return (
      <section className="panel adm-panel">
        <form className="adm-form" onSubmit={unlock}>
          <div className="adm-found"><QrCode size={18} /><div><strong>{meta.label}</strong><small>{meta.expiresAt ? `Expires ${formatStamp(meta.expiresAt)}` : 'No expiry'}</small></div></div>
          <label>Verification code
            <input autoFocus autoComplete="off" autoCapitalize="characters" spellCheck="false" className="adm-code-input" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXXX-XXXXX" />
          </label>
          {error && <p className="adm-error" role="alert">{error}</p>}
          <div className="adm-btn-row">
            <button type="button" className="secondary-btn" onClick={reset}>Scan another</button>
            <button className="primary-btn" type="submit" disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length < 10}><LockKeyhole size={16} /> {busy ? 'Unlocking…' : 'Unlock'}</button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="panel adm-panel">
      <div className="adm-sources">
        <button type="button" className={`adm-source ${source === 'camera' ? 'on' : ''}`} onClick={() => { setError(''); setSource(source === 'camera' ? '' : 'camera'); }}><Camera size={20} /><strong>Scan with camera</strong><small>Point it at the QR</small></button>
        <button type="button" className="adm-source" onClick={() => fileRef.current?.click()}><Upload size={20} /><strong>Upload image</strong><small>Photo or downloaded PNG</small></button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
      {source === 'camera' && <CameraScanner onFound={accept} onError={msg => { setSource(''); setError(msg); }} />}
      <form className="adm-form adm-paste" onSubmit={e => { e.preventDefault(); accept(pasted); }}>
        <label>Or paste the QR text
          <textarea rows="2" value={pasted} onChange={e => setPasted(e.target.value)} placeholder="XQR1.q_…" spellCheck="false" />
        </label>
        <div className="adm-btn-row"><button className="secondary-btn" type="submit" disabled={!pasted.trim() || busy}>Read QR text</button></div>
      </form>
      {error && <p className="adm-error" role="alert">{error}</p>}
    </section>
  );
}
