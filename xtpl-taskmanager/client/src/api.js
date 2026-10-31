const API = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '');
const TOKEN_KEY = 'xtpl-token';
const REFRESH_KEY = 'xtpl-refresh';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);

export const setToken = token => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

// Store the JWT pair returned by /auth/verify-otp or /auth/refresh.
export const setSession = ({ token, refreshToken } = {}) => {
  setToken(token || null);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  else localStorage.removeItem(REFRESH_KEY);
};

export const clearSession = () => setSession({});

// Revoke the refresh token on the server, then forget both tokens locally.
export async function logoutSession() {
  const refreshToken = getRefreshToken();
  clearSession();
  if (!refreshToken) return;
  try {
    await fetch(`${API}/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
  } catch { /* offline: token expires on its own */ }
}

// One refresh at a time, shared by all requests that hit a 401 together.
let refreshing = null;
function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return Promise.resolve(false);
  if (!refreshing) {
    // true = new tokens stored, false = the server rejected the refresh token, null = server unreachable
    refreshing = fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) })
      .then(async res => {
        if (!res.ok) return res.status >= 500 ? null : false;
        setSession(await res.json());
        return true;
      })
      .catch(() => null)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function apiFetch(path, opts = {}) {
  const build = () => {
    const headers = { ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    if (opts.body && !isForm && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return { ...opts, headers };
  };
  let res = await fetch(`${API}${path}`, build());
  const isAuthCall = path.startsWith('/auth/login') || path.startsWith('/auth/verify-otp') || path.startsWith('/auth/resend-otp') || path.startsWith('/auth/signup') || path.startsWith('/auth/refresh') || path.startsWith('/auth/forgot-password') || path.startsWith('/auth/reset-password');
  if (res.status === 401 && !isAuthCall && getToken()) {
    // Access token expired: silently swap it using the refresh token, then retry once.
    // (FormData bodies can be re-sent safely because the browser keeps the file references.)
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await fetch(`${API}${path}`, build());
    }
    // A network blip while refreshing (refreshed === null) must not sign the person out.
    if (res.status === 401 && refreshed !== null) {
      clearSession();
      window.dispatchEvent(new Event('xtpl-auth-expired'));
    }
  }
  return res;
}

export async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function saveBlob(res, filename) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadApiFile(stored, filename) {
  const res = await apiFetch(`/files/${encodeURIComponent(stored)}`);
  if (!res.ok) throw new Error('Could not download file');
  await saveBlob(res, filename || stored);
}

export async function downloadDocument(id, filename) {
  const res = await apiFetch(`/documents/${encodeURIComponent(id)}/download`);
  if (!res.ok) throw new Error((await readJson(res)).error || 'Could not download file');
  await saveBlob(res, filename || 'document');
}

// Small helper so any component can show a toast without prop drilling.
export const toastMessage = message => window.dispatchEvent(new CustomEvent('xtpl-toast', { detail: message }));
