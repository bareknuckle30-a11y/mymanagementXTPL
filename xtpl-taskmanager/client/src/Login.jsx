import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole, Mail, RefreshCw, Shield, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { apiFetch, readJson, setSession } from './api.js';
import { ThemeToggle } from './Theme.jsx';

const adminDemos = [
  { email: 'ananya@xtpl.com', password: 'admin123', name: 'Ananya Mehta' },
  { email: 'rahul@xtpl.com', password: 'admin123', name: 'Rahul Verma' },
];

const employeeDemos = [
  { email: 'meera@xtpl.com', password: 'work123', name: 'Meera Lal' },
  { email: 'jay@xtpl.com', password: 'work123', name: 'Jay Desai' },
  { email: 'sana@xtpl.com', password: 'work123', name: 'Sana Khan' },
];

const LOGO = `${import.meta.env.BASE_URL}xtpl-logo.jpg`;

export default function Login({ onLogin }) {
  const [tab, setTab] = useState('admin');
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(null); // set after the password step when an OTP is required
  const [resetToken, setResetToken] = useState(null);
  const [adminSignup, setAdminSignup] = useState('invite'); // 'invite' | 'open' | 'disabled' (from /api/health)

  useEffect(() => {
    apiFetch('/health').then(readJson).then(d => { if (d?.adminSignup) setAdminSignup(d.adminSignup); }).catch(() => {});
  }, []);

  const finish = data => {
    setSession({ token: data.token, refreshToken: data.refreshToken });
    onLogin(data.user);
  };

  const switchTab = next => {
    setTab(next);
    setMode('signin');
    setError('');
    setName('');
    setEmail('');
    setPassword('');
    setConfirm('');
    setInviteCode('');
    setChallenge(null);
    setResetToken(null);
  };

  const startForgot = () => {
    setMode('forgot');
    setError('');
    setPassword('');
    setConfirm('');
    setChallenge(null);
    setResetToken(null);
  };

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'forgot') {
        const res = await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || 'Could not start a password reset');
        if (data.otpRequired) { setChallenge(data); return; }
        setError(data.message || 'If that email is on an account, a reset code was sent.');
        return;
      }
      if (mode === 'signup') {
        if (!/@(gmail|googlemail)\.com$/i.test(email.trim())) {
          throw new Error(`Use a Gmail address to sign up as ${tab === 'admin' ? 'an admin' : 'an employee'}.`);
        }
        if (tab === 'admin' && adminSignup === 'disabled') {
          throw new Error('Admin signup is turned off. Ask an existing admin to add you from Team.');
        }
        if (password !== confirm) throw new Error('Passwords do not match');
        const res = await apiFetch('/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name, email, password, role: tab, inviteCode: tab === 'admin' && adminSignup === 'invite' ? inviteCode : undefined }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error || 'Could not create account');
        if (data.otpRequired) { setChallenge(data); return; }
        finish(data);
        return;
      }
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, as: tab }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Could not sign in');
      if (data.otpRequired) { setChallenge(data); return; }
      finish(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const demos = tab === 'admin' ? adminDemos : employeeDemos;

  const onOtpVerified = data => {
    if (data.resetRequired) {
      setResetToken(data.resetToken);
      setChallenge(null);
      setPassword('');
      setConfirm('');
      return;
    }
    finish(data);
  };

  if (challenge) {
    return (
      <div className="login-shell">
        <ThemeToggle className="login-theme" />
        <OtpStep
          challenge={challenge}
          setChallenge={setChallenge}
          onVerified={onOtpVerified}
          onBack={() => { setChallenge(null); setError(''); }}
        />
      </div>
    );
  }

  if (resetToken) {
    return (
      <div className="login-shell">
        <ThemeToggle className="login-theme" />
        <ResetPassword
          resetToken={resetToken}
          onBack={() => { setResetToken(null); setMode('signin'); setError(''); }}
          onDone={() => {
            setResetToken(null);
            setMode('signin');
            setPassword('');
            setConfirm('');
            setError('Password updated. Sign in with your new password.');
          }}
        />
      </div>
    );
  }

  return (
    <div className="login-shell">
      <ThemeToggle className="login-theme" />
      <div className="login-card glass-panel">
        <div className="login-brand">
          <div className="xt-logo" style={{ '--s': '64px' }} aria-label="XTPL logo">
            <span className="xt-ring" />
            <span className="xt-glow" />
            <div className="xt-disc"><img src={LOGO} alt="XTPL" /></div>
          </div>
          <strong>XTPL TaskManager</strong>
          <p>Admins and employees sign up with Gmail and verify with an emailed code. Admins assign and schedule work; employees pick tasks and upload completed files.</p>
        </div>
        <div className="login-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'admin'} className={tab === 'admin' ? 'chosen' : ''} onClick={() => switchTab('admin')}>
            <Shield size={14} /> Admin
          </button>
          <button type="button" role="tab" aria-selected={tab === 'employee'} className={tab === 'employee' ? 'chosen' : ''} onClick={() => switchTab('employee')}>
            <Users size={14} /> Employee
          </button>
        </div>
        {mode !== 'forgot' && (
          <div className="login-modes">
            <button type="button" className={mode === 'signin' ? 'chosen' : ''} onClick={() => { setMode('signin'); setError(''); }}>Sign in</button>
            <button type="button" className={mode === 'signup' ? 'chosen' : ''} onClick={() => { setMode('signup'); setError(''); setName(''); setPassword(''); setConfirm(''); setInviteCode(''); }}>Sign up with Gmail</button>
          </div>
        )}
        {mode === 'signup' && tab === 'admin' && adminSignup === 'disabled' && (
          <p className="forgot-lead">Admin self-signup is turned off on this server. Ask an existing admin to add you from the Team page.</p>
        )}
        {mode === 'forgot' && (
          <p className="forgot-lead">Enter the email on your account. We will send a 6-digit code to that personal inbox so you can set a new password.</p>
        )}
        <form onSubmit={submit} className="login-form">
          {mode === 'signup' && (
            <label>
              Full name
              <span className="login-input">
                <UserPlus size={16} />
                <input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
              </span>
            </label>
          )}
          <label>
            {mode === 'signup' ? 'Gmail' : 'Email'}
            <span className="login-input">
              <Mail size={16} />
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={mode === 'signup' || tab === 'employee' ? 'you@gmail.com' : 'admin@company.com'}
              />
            </span>
          </label>
          {mode !== 'forgot' && (
            <label>
              Password
              <span className="login-input">
                <LockKeyhole size={16} />
                <input type="password" required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" />
              </span>
            </label>
          )}
          {mode === 'signup' && tab === 'admin' && adminSignup === 'invite' && (
            <label>
              Admin invitation code
              <span className="login-input">
                <ShieldCheck size={16} />
                <input type="password" required autoComplete="off" value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Enter the code from your administrator" />
              </span>
            </label>
          )}
          {mode === 'signup' && (
            <label>
              Confirm password
              <span className="login-input">
                <LockKeyhole size={16} />
                <input type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" />
              </span>
            </label>
          )}
          {(mode === 'signin' || mode === 'signup') && (
            <button type="button" className="forgot-link" onClick={startForgot}>Forgot your password?</button>
          )}
          {error && <div className={`login-error ${error.startsWith('Password updated') || error.startsWith('If that email') ? 'login-ok' : ''}`}>{error}</div>}
          <button className="primary-btn login-submit" disabled={busy || (mode === 'signup' && tab === 'admin' && adminSignup === 'disabled')} type="submit">
            {busy ? 'Please wait…' : mode === 'forgot' ? 'Send reset code' : mode === 'signup' ? (tab === 'admin' ? 'Create admin account' : 'Create employee account') : tab === 'admin' ? 'Enter as admin' : 'Enter as employee'}
            <ArrowRight size={16} />
          </button>
          {mode === 'forgot' && (
            <button type="button" className="otp-resend" onClick={() => { setMode('signin'); setError(''); }}>
              <ArrowLeft size={13} /> Back to sign in
            </button>
          )}
        </form>
        {mode === 'signin' && (
          <div className="demo-accounts">
            <span>{tab === 'admin' ? 'Admin demo accounts' : 'Employee demo accounts'}</span>
            {demos.map(d => (
              <button key={d.email} type="button" className="demo-chip" onClick={() => { setEmail(d.email); setPassword(d.password); setError(''); }}>
                {tab === 'admin' ? <Shield size={13} /> : <Users size={13} />}
                <em>{d.name}</em>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const OTP_LEN = 6;

function fmt(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

function OtpStep({ challenge, setChallenge, onVerified, onBack }) {
  const [digits, setDigits] = useState(Array(OTP_LEN).fill(''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [times, setTimes] = useState(() => ({ sent: Date.now() }));
  const refs = useRef([]);
  const busyRef = useRef(false);

  // restart timers whenever a fresh code is issued
  useEffect(() => { setTimes({ sent: Date.now() }); setDigits(Array(OTP_LEN).fill('')); setError(''); refs.current[0]?.focus(); }, [challenge.challengeToken]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

  const elapsed = Math.floor((now - times.sent) / 1000);
  const expiresIn = Math.max(challenge.expiresInSeconds - elapsed, 0);
  const resendIn = Math.max(challenge.resendInSeconds - elapsed, 0);
  const code = digits.join('');

  const verify = async value => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ challengeToken: challenge.challengeToken, otp: value }) });
      const data = await readJson(res);
      if (!res.ok) {
        setError(data.error || 'Could not verify the code');
        setDigits(Array(OTP_LEN).fill(''));
        refs.current[0]?.focus();
        return;
      }
      onVerified(data);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const setAt = (i, v) => {
    const next = [...digits];
    next[i] = v;
    setDigits(next);
    if (next.every(Boolean)) verify(next.join(''));
  };

  const onChange = (i, e) => {
    const v = e.target.value.replace(/\D/g, '');
    if (!v) return setAt(i, '');
    if (v.length > 1) return fillFrom(i, v);
    setAt(i, v);
    if (i < OTP_LEN - 1) refs.current[i + 1]?.focus();
  };

  const fillFrom = (start, text) => {
    const chars = text.replace(/\D/g, '').slice(0, OTP_LEN - start).split('');
    if (!chars.length) return;
    const next = [...digits];
    chars.forEach((c, k) => { next[start + k] = c; });
    setDigits(next);
    refs.current[Math.min(start + chars.length, OTP_LEN - 1)]?.focus();
    if (next.every(Boolean)) verify(next.join(''));
  };

  const onKeyDown = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < OTP_LEN - 1) refs.current[i + 1]?.focus();
  };

  const resend = async () => {
    setResending(true);
    setError('');
    try {
      const res = await apiFetch('/auth/resend-otp', { method: 'POST', body: JSON.stringify({ challengeToken: challenge.challengeToken }) });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Could not send a new code');
      setChallenge(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <form className="login-card glass-panel otp-card" onSubmit={e => { e.preventDefault(); if (code.length === OTP_LEN) verify(code); }}>
      <button type="button" className="otp-back" onClick={onBack}><ArrowLeft size={14} /> Back</button>
      <div className="otp-icon"><ShieldCheck size={26} /></div>
      <h2>{challenge.purpose === 'signup' ? 'Verify your email' : challenge.purpose === 'reset' ? 'Reset your password' : 'Two-step verification'}</h2>
      <p className="otp-sub">
        {challenge.channel === 'email'
          ? <>We emailed a 6-digit code to <strong>{challenge.email}</strong>.</>
          : <>A 6-digit code was generated for <strong>{challenge.email}</strong>.</>}
        {' '}Enter it below to {challenge.purpose === 'signup' ? 'finish creating your account' : challenge.purpose === 'reset' ? 'choose a new password' : 'finish signing in'}.
      </p>
      {challenge.devOtp && (
        <div className="otp-dev">
          <span>Development mode: no email server is set up, so the code is shown here and in the server terminal.</span>
          <button type="button" onClick={() => { setDigits(challenge.devOtp.split('')); verify(challenge.devOtp); }}>
            Code <strong>{challenge.devOtp}</strong> · fill it in
          </button>
        </div>
      )}
      <div className="otp-boxes" role="group" aria-label="One-time code">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el; }}
            className={`otp-box ${error ? 'bad' : ''}`}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={OTP_LEN}
            value={d}
            disabled={busy}
            aria-label={`Digit ${i + 1}`}
            onChange={e => onChange(i, e)}
            onKeyDown={e => onKeyDown(i, e)}
            onPaste={e => { e.preventDefault(); fillFrom(i, e.clipboardData.getData('text')); }}
            onFocus={e => e.target.select()}
          />
        ))}
      </div>
      {error && <div className="login-error">{error}</div>}
      <p className={`otp-timer ${expiresIn === 0 ? 'out' : ''}`}>{expiresIn > 0 ? `Code expires in ${fmt(expiresIn)}` : 'This code has expired. Request a new one.'}</p>
      <button className="primary-btn login-submit" type="submit" disabled={busy || code.length < OTP_LEN || expiresIn === 0}>
        {busy ? 'Verifying…' : challenge.purpose === 'reset' ? 'Verify code' : 'Verify and continue'} <ArrowRight size={16} />
      </button>
      <button type="button" className="otp-resend" disabled={resendIn > 0 || resending} onClick={resend}>
        <RefreshCw size={13} /> {resending ? 'Sending…' : resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
      </button>
    </form>
  );
}

function ResetPassword({ resetToken, onBack, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ resetToken, password }) });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Could not update password');
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="login-card glass-panel otp-card" onSubmit={submit}>
      <button type="button" className="otp-back" onClick={onBack}><ArrowLeft size={14} /> Back</button>
      <div className="otp-icon"><KeyRound size={26} /></div>
      <h2>Choose a new password</h2>
      <p className="otp-sub">Enter a new password for your account. You will sign in with it next.</p>
      <label className="reset-field">
        New password
        <span className="login-input">
          <LockKeyhole size={16} />
          <input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters" />
        </span>
      </label>
      <label className="reset-field">
        Confirm password
        <span className="login-input">
          <LockKeyhole size={16} />
          <input type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" />
        </span>
      </label>
      {error && <div className="login-error">{error}</div>}
      <button className="primary-btn login-submit" disabled={busy} type="submit">
        {busy ? 'Saving…' : 'Update password'} <ArrowRight size={16} />
      </button>
    </form>
  );
}
