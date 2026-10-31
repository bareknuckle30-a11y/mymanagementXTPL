import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { apiFetch, readJson } from './api.js';
import { formatClock, formatStamp } from './attendanceUtils.js';

// Login-hour monitor for the signed-in person. The clock started on the server the moment they signed in;
// this beats every minute so the server knows the page is still open, and ticks the timer in the top bar.
// Signing out (or closing the app for a few minutes) stops it and writes the end time to the Login report.
export default function SessionClock() {
  const [info, setInfo] = useState(null); // { startMs, offsetMs, since }
  const [, tick] = useState(0);

  useEffect(() => {
    let stopped = false;
    const beat = async () => {
      try {
        const res = await apiFetch('/attendance/heartbeat', { method: 'POST' });
        if (!res.ok || stopped) return;
        const data = await readJson(res);
        if (stopped) return;
        if (data.tracking && data.session) {
          setInfo({ startMs: Date.parse(data.session.loginAt), offsetMs: Date.parse(data.serverNow) - Date.now(), since: data.session.loginAt });
        } else setInfo(null);
      } catch { /* offline: the next beat will catch up */ }
    };
    beat();
    const every = setInterval(beat, 60 * 1000);
    const onVisible = () => { if (!document.hidden) beat(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearInterval(every); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    if (!info) return undefined;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [info]);

  if (!info) return null;
  // The server's clock is the reference, so a wrong clock on this computer cannot skew the timer.
  const elapsed = (Date.now() + info.offsetMs - info.startMs) / 1000;
  return (
    <div className="session-clock" title={`Logged in since ${formatStamp(info.since)}. Recorded in the Login report; stops when you sign out.`}>
      <span className="session-clock-dot" />
      <Clock size={14} />
      <span className="session-clock-time">{formatClock(elapsed)}</span>
    </div>
  );
}
