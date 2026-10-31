// Email digest for team chat messages that people were not online to see.
//
//  * Only people who are NOT connected to the app get mail (anyone online already got the live alert).
//  * A short delay first: if they come back online before it ends, nothing is sent.
//  * Messages are bundled: at most one email per person per interval, however busy the chat is.
//  * People can switch it off (user.chatEmails === false). Unverified accounts are skipped.
//
// The dependencies are passed in so the rules can be tested without a mail server or sockets.
export function createChatEmailer({ loadUsers, isOnline, sendDigest, delayMs = 60000, intervalMs = 600000, now = Date.now, keep = 50 }) {
  const waiting = new Map(); // userId -> { msgs, timer, lastSent }

  const eligible = (u, message) => u.id !== message.userId && u.email && u.emailVerified !== false && u.chatEmails !== false;

  async function flush(userId) {
    const entry = waiting.get(userId);
    if (!entry) return;
    entry.timer = null;
    const messages = entry.msgs;
    entry.msgs = [];
    if (!messages.length) return;
    const user = (await loadUsers()).find(u => u.id === userId);
    if (!user || user.chatEmails === false || user.emailVerified === false || !user.email) return;
    if (await isOnline(userId)) return; // they are back and have seen the messages
    entry.lastSent = now();
    await sendDigest({ user, messages });
  }

  function schedule(userId) {
    const entry = waiting.get(userId);
    if (entry.timer) return;
    const wait = Math.max(delayMs, (entry.lastSent || 0) + intervalMs - now());
    entry.timer = setTimeout(() => flush(userId).catch(err => console.error('[chat-email]', err.message)), wait);
    entry.timer.unref?.();
  }

  return {
    async onMessage(message) {
      for (const u of await loadUsers()) {
        if (!eligible(u, message)) continue;
        if (await isOnline(u.id)) continue;
        const entry = waiting.get(u.id) || { msgs: [], timer: null, lastSent: 0 };
        waiting.set(u.id, entry);
        entry.msgs.push(message);
        if (entry.msgs.length > keep) entry.msgs.splice(0, entry.msgs.length - keep);
        schedule(u.id);
      }
    },
    flush,
  };
}
