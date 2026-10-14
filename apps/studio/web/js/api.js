// Control-plane client. The UI never touches the OS: everything goes through this authenticated, loopback API.
export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail ?? null;
  }
}

const auth = { token: null, injected: false };

export function initAuth() {
  // Desktop shell: the main process attaches the token to our requests; the page never sees it.
  if (window.eraDesktop?.injectedAuth) {
    auth.injected = true;
    return true;
  }
  const m = /[#&]token=([0-9a-f]{64})/.exec(location.hash);
  try {
    if (m) {
      auth.token = m[1];
      sessionStorage.setItem('era.token', m[1]);
      history.replaceState(null, '', location.pathname + location.search + (location.hash.replace(/[#&]token=[0-9a-f]{64}/, '') || '#/'));
    } else auth.token = sessionStorage.getItem('era.token');
  } catch {
    // storage may be unavailable; a token in the URL still works for this page load
  }
  return !!auth.token;
}

const headers = (extra = {}) => ({ ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}), ...extra });

export async function api(method, path, body) {
  const res = await fetch(path, { method, headers: headers(body !== undefined ? { 'Content-Type': 'application/json' } : {}), body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`, json?.detail);
  return json;
}
export const get = (p) => api('GET', p);
export const patch = (p, b = {}) => api('PATCH', p, b);

// Authenticated binary fetch (an <img src> cannot carry the Authorization header in browser mode).
export async function getBlob(path) {
  const res = await fetch(path, { headers: headers() });
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.blob();
}

// Raw image upload (PNG/JPEG/WebP). `set` groups several screenshots into one reference folder.
export async function uploadImage(file, set = null) {
  const res = await fetch(`/api/uploads${set ? `?set=${set}` : ''}&name=${encodeURIComponent(file.name ?? '')}`.replace('/uploads&', '/uploads?'), { method: 'POST', headers: headers({ 'Content-Type': file.type || 'application/octet-stream' }), body: file });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`, json?.detail);
  return json;
}
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

// Server-Sent Events over fetch (so the Authorization header can be used), with backoff and Last-Event-ID resume.
export function connectEvents(onEvent, onStatus) {
  let stopped = false;
  let lastId = null;
  let attempt = 0;
  let ctrl = null;
  async function loop() {
    while (!stopped) {
      ctrl = new AbortController();
      try {
        onStatus('connecting');
        const res = await fetch('/api/events', { headers: headers(lastId !== null ? { 'Last-Event-ID': String(lastId) } : {}), signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        attempt = 0;
        onStatus('live');
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const m = /^data: (.*)$/m.exec(block);
            if (!m) continue;
            const ev = JSON.parse(m[1]);
            if (typeof ev.id === 'number') lastId = ev.id;
            if (ev.type === 'hello' && lastId === null) lastId = ev.data.last_event_id;
            onEvent(ev);
          }
        }
      } catch (err) {
        if (stopped) return;
        onStatus('offline', err.message);
      }
      attempt++;
      await new Promise((r) => setTimeout(r, Math.min(15_000, 500 * 2 ** Math.min(attempt, 5))));
    }
  }
  loop();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}

export function streamTerminal(id, onMessage) {
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api/terminals/${id}/stream`, { headers: headers(), signal: ctrl.signal });
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const m = /^data: (.*)$/m.exec(buf.slice(0, i));
          buf = buf.slice(i + 2);
          if (m) onMessage(JSON.parse(m[1]));
        }
      }
    } catch {
      // closed
    }
  })();
  return () => ctrl.abort();
}

export const download = (name, text, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
