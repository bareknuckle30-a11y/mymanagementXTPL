import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { MessageCircle, Send, Wifi, WifiOff } from 'lucide-react';
import { apiFetch, getToken, readJson } from './api.js';

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || window.location.origin).replace(/\/$/, '');

function mergeMessages(current, incoming) {
  const byId = new Map();
  [...current, ...(Array.isArray(incoming) ? incoming : [])].forEach(message => { if (message?.id) byId.set(message.id, message); });
  return [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).slice(-100);
}
export default function ChatPage({ user }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const socketRef = useRef(null);
  const endRef = useRef(null);
  useEffect(() => {
    // Read the token at every (re)connect, so a token renewed by apiFetch is picked up.
    const socket = io(SOCKET_URL, { auth: cb => cb({ token: getToken() }), transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    let retriedAuth = false;
    socket.on('connect', () => { retriedAuth = false; setStatus('connected'); setError(''); });
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', async err => {
      setStatus('disconnected');
      setError(err.message || 'Could not connect to chat');
      // The server refuses expired access tokens and the client does not retry that by itself.
      // Any API call renews the token with the refresh token; then connect once more.
      if (!retriedAuth && /sign in again/i.test(err.message || '')) {
        retriedAuth = true;
        const res = await apiFetch('/auth/me').catch(() => null);
        if (res?.ok && socketRef.current === socket && !socket.connected) socket.connect();
      }
    });
    socket.on('chat:history', list => setMessages(prev => mergeMessages(prev, list)));
    socket.on('chat:message', msg => setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]));
    socket.on('chat:error', msg => setError(msg || 'Message could not be sent'));
    // Load history over HTTP too, so interrupted Socket.IO history delivery does not leave the page empty.
    apiFetch('/chat/messages').then(async res => {
      if (res.ok) {
        const history = await readJson(res);
        setMessages(prev => mergeMessages(prev, history));
      }
    }).catch(() => {});
    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  const send = e => {
    e.preventDefault();
    const text = draft.trim();
    const socket = socketRef.current;
    if (!text || !socket?.connected || sending) return;
    setSending(true); setError('');
    socket.timeout(10000).emit('chat:send', { text }, (timeoutError, result) => {
      setSending(false);
      if (timeoutError) { setError('No confirmation from the server. Your message was not cleared; please retry.'); return; }
      if (!result?.ok) { setError(result?.error || 'Message could not be saved. Please retry.'); return; }
      setDraft(current => current === text ? '' : current);
    });
  };
  const time = value => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <section className="chat-page">
    <div className="chat-heading"><div className="chat-title-icon"><MessageCircle size={22}/></div><div><h1>Team chat</h1><p className="subtitle">Real-time conversations with your workspace</p></div><div className={`chat-status ${status}`} >{status === 'connected' ? <Wifi size={15}/> : <WifiOff size={15}/>} {status === 'connected' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Offline'}</div></div>
    <div className="chat-panel glass-panel"><div className="chat-stream">
      {!messages.length && <div className="chat-empty"><MessageCircle size={32}/><strong>Start the conversation</strong><span>Send a message to everyone in your workspace.</span></div>}
      {messages.map(m => <div className={`chat-message ${m.userId === user.id ? 'mine' : ''}`} key={m.id}><div className="chat-avatar">{(m.name || '?').split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase()}</div><div className="chat-message-content"><div className="chat-message-meta"><strong>{m.userId === user.id ? 'You' : m.name}</strong><time>{time(m.createdAt)}</time></div><div className="chat-bubble">{m.text}</div></div></div>)}<div ref={endRef}/>
    </div>{error && <div className="chat-error">{error}</div>}<form className="chat-composer" onSubmit={send}><input value={draft} onChange={e=>setDraft(e.target.value)} maxLength={2000} placeholder={status === 'connected' ? 'Write a message…' : 'Waiting for chat connection…'} disabled={status !== 'connected'} aria-label="Message"/><span className="chat-char-count">{draft.length}/2000</span><button className="primary-btn" type="submit" disabled={!draft.trim() || status !== 'connected' || sending}>{sending ? 'Saving…' : <><Send size={16}/> Send</>}</button></form></div>
    <p className="chat-note">Messages are saved by the server before the app confirms delivery (local JSON, or Supabase when configured) and the last 100 are loaded when you connect.</p>
  </section>;
}
