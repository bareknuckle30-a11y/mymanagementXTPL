import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './theme.css';
import './admin.css';
import { apiFetch, clearSession, getToken, logoutSession, readJson } from './api.js';
import Login from './Login.jsx';
import App from './App.jsx';
import { applyTheme, initialTheme } from './Theme.jsx';

applyTheme(initialTheme());

const LOGO = `${import.meta.env.BASE_URL}xtpl-logo.jpg`;
function LogoMark({ size = 46 }) {
  return (
    <div className="xt-logo" style={{ '--s': `${size}px` }} aria-label="XTPL logo">
      <span className="xt-ring" />
      <span className="xt-glow" />
      <div className="xt-disc"><img src={LOGO} alt="XTPL" /></div>
    </div>
  );
}

function Splash({ stay }) {
  const [phase, setPhase] = useState('show');
  useEffect(() => {
    if (stay) return undefined;
    const a = setTimeout(() => setPhase('hide'), 1900);
    const b = setTimeout(() => setPhase('gone'), 2500);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [stay]);
  if (phase === 'gone') return null;
  return (
    <div className={`splash ${phase === 'hide' ? 'splash-out' : ''}`}>
      <LogoMark size={150} />
      <div className="splash-title">XTPL <span>TaskManager</span></div>
      <div className="splash-bar"><i /></div>
    </div>
  );
}

function Root() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const restore = () => {
    setOffline(false);
    setReady(false);
    apiFetch('/auth/me').then(async res => {
      if (res.ok) { setUser(await readJson(res)); return; }
      if (res.status === 401) { clearSession(); setUser(null); return; }
      throw new Error('server error');
    }).catch(() => setOffline(true)).finally(() => setReady(true));
  };
  useEffect(() => {
    const expired = () => { setUser(null); setReady(true); };
    window.addEventListener('xtpl-auth-expired', expired);
    if (!getToken()) setReady(true); else restore();
    return () => window.removeEventListener('xtpl-auth-expired', expired);
  }, []);
  const logout = () => { logoutSession(); setUser(null); };
  if (!ready) return <Splash stay />;
  // The server could not be reached: keep the saved sign-in and let the person retry,
  // instead of silently logging them out.
  if (offline && !user) {
    return (
      <div className="login-shell">
        <div className="login-card glass-panel" style={{ textAlign: 'center' }}>
          <div className="login-brand"><strong>Cannot reach the server</strong><p>Check your connection. Your sign-in is kept, so you can pick up where you left off.</p></div>
          <button className="primary-btn login-submit" type="button" onClick={restore}>Try again</button>
        </div>
      </div>
    );
  }
  if (!user) return <><Login onLogin={setUser} /><Splash /></>;
  return <App user={user} onLogout={logout} />;
}

createRoot(document.getElementById('root')).render(<Root />);
export { LogoMark };
