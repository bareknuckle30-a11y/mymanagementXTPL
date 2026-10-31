import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, MessageCircle, ClipboardList, Inbox, Volume2, VolumeX } from 'lucide-react';
import { io } from 'socket.io-client';
import { apiFetch, getToken } from './api.js';

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || window.location.origin).replace(/\/$/, '');
const SOUND_KEY = 'xtpl-alert-sound';
const MAX_ITEMS = 25;

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

let audio = null;
function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.36);
  } catch { /* sound is a nicety; blocked until the person has clicked something */ }
}

const supportsDesktop = () => typeof window !== 'undefined' && 'Notification' in window;

// Live alerts over the same Socket.IO server that powers chat:
//  - the admin assigns you a task  -> the server pushes a "notify" event to your account
//  - someone posts in team chat    -> every connected person receives "chat:message"
// Alerts show as a toast, in the bell list, as a badge on Chat, and (when allowed and the tab is in the
// background) as a desktop notification.
export function useLiveNotifications({ user, page, go, toast, onTasksChanged }) {
  const [items, setItems] = useState([]);
  const [chatUnread, setChatUnread] = useState(0);
  const [sound, setSoundState] = useState(() => store.get(SOUND_KEY) !== 'off');
  const [permission, setPermission] = useState(() => (supportsDesktop() ? Notification.permission : 'unsupported'));
  const live = useRef({});
  live.current = { page, go, toast, onTasksChanged, sound };

  const raise = (item, target) => {
    const { toast: say, go: open, sound: beepOn } = live.current;
    setItems(prev => [{ ...item, read: false }, ...prev].slice(0, MAX_ITEMS));
    say(`${item.title}: ${item.body}`.slice(0, 140));
    if (beepOn) beep();
    if (document.hidden && supportsDesktop() && Notification.permission === 'granted') {
      try {
        const n = new Notification(item.title, { body: item.body, tag: item.id, icon: `${import.meta.env.BASE_URL}favicon.png` });
        n.onclick = () => { window.focus(); open(target); n.close(); };
      } catch { /* some mobile browsers only allow notifications from a service worker */ }
    }
  };

  useEffect(() => {
    const seen = new Set();
    const socket = io(SOCKET_URL, { auth: cb => cb({ token: getToken() }), transports: ['websocket', 'polling'] });
    let retried = false;
    socket.on('connect', () => { retried = false; });
    socket.on('connect_error', async err => {
      // An expired access token is refused; any API call renews it, then connect once more.
      if (!retried && /sign in again/i.test(err.message || '')) {
        retried = true;
        const res = await apiFetch('/auth/me').catch(() => null);
        if (res?.ok && !socket.connected) socket.connect();
      }
    });
    socket.on('chat:message', msg => {
      if (!msg?.id || msg.userId === user.id || seen.has(msg.id)) return;
      seen.add(msg.id);
      const watching = live.current.page === 'Chat' && !document.hidden;
      if (watching) return; // already reading the conversation
      setChatUnread(n => n + 1);
      raise({ id: `chat_${msg.id}`, type: 'chat', title: msg.name || 'New message', body: msg.text, createdAt: msg.createdAt }, 'Chat');
    });
    socket.on('notify', n => {
      if (!n?.id || seen.has(n.id)) return;
      seen.add(n.id);
      raise(n, user.role === 'admin' ? 'All tasks' : 'My work');
      if (n.type === 'task') live.current.onTasksChanged?.();
    });
    // If the connection was lost (laptop slept, token expired), try again every minute.
    const recover = setInterval(async () => {
      if (socket.connected || document.hidden) return;
      const res = await apiFetch('/auth/me').catch(() => null);
      if (res?.ok && !socket.connected) socket.connect();
    }, 60000);
    return () => { clearInterval(recover); socket.disconnect(); };
  }, [user.id]);

  // Opening the chat (or coming back to its tab) clears the badge.
  useEffect(() => {
    const clear = () => { if (live.current.page === 'Chat' && !document.hidden) setChatUnread(0); };
    clear();
    document.addEventListener('visibilitychange', clear);
    return () => document.removeEventListener('visibilitychange', clear);
  }, [page]);

  const markAllRead = () => setItems(prev => prev.map(i => ({ ...i, read: true })));
  const setSound = on => { setSoundState(on); store.set(SOUND_KEY, on ? 'on' : 'off'); if (on) beep(); };
  const enableDesktop = async () => {
    if (!supportsDesktop()) return;
    try { setPermission(await Notification.requestPermission()); } catch { /* old Safari uses a callback form */ }
  };

  return { items, chatUnread, unread: items.filter(i => !i.read).length, sound, setSound, permission, enableDesktop, markAllRead };
}

const ICON = { chat: MessageCircle, task: ClipboardList };
const ago = iso => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
};

export function NotificationBell({ live, submittedCount, isAdmin, go }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = e => { if (!wrap.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);

  const badge = live.unread + (isAdmin ? submittedCount : 0);
  const toggle = () => { setOpen(o => !o); if (open) live.markAllRead(); };
  const jump = (target) => { setOpen(false); live.markAllRead(); go(target); };

  return (
    <div className="notif-wrap" ref={wrap}>
      <button className="icon-btn notification-btn" title="Notifications" aria-label={`Notifications${badge ? `, ${badge} new` : ''}`} aria-expanded={open} onClick={toggle}>
        {live.unread ? <BellRing size={18} /> : <Bell size={18} />}{badge > 0 && <i />}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            <button type="button" className="icon-btn tiny" title={live.sound ? 'Mute alert sound' : 'Turn on alert sound'} aria-label={live.sound ? 'Mute alert sound' : 'Turn on alert sound'} onClick={() => live.setSound(!live.sound)}>
              {live.sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
          {live.permission === 'default' && (
            <button type="button" className="notif-enable" onClick={live.enableDesktop}><BellRing size={15} /> Also alert me when this tab is in the background</button>
          )}
          {live.permission === 'denied' && <p className="notif-note">Desktop alerts are blocked for this site. Allow them in your browser's site settings.</p>}
          {isAdmin && submittedCount > 0 && (
            <button type="button" className="notif-item" onClick={() => jump('Inbox')}>
              <Inbox size={16} /><span><strong>{submittedCount} submission{submittedCount === 1 ? '' : 's'} to review</strong><small>Open the inbox</small></span>
            </button>
          )}
          {live.items.map(i => {
            const Icon = ICON[i.type] || Bell;
            return (
              <button type="button" key={i.id} className={`notif-item ${i.read ? '' : 'new'}`} onClick={() => jump(i.type === 'chat' ? 'Chat' : isAdmin ? 'All tasks' : 'My work')}>
                <Icon size={16} /><span><strong>{i.title}</strong><small>{i.body}</small><em>{ago(i.createdAt)}</em></span>
              </button>
            );
          })}
          {!live.items.length && !(isAdmin && submittedCount > 0) && <p className="notif-note">You are all caught up. New tasks and chat messages show up here instantly.</p>}
        </div>
      )}
    </div>
  );
}
