/* Cliente de red: API REST + Socket.io (con degradacion offline) */
export async function api(path, method = 'GET', body, token) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* sin cuerpo */ }
  if (!res.ok) throw new Error(data.error || 'Error de red (' + res.status + ')');
  return data;
}

export class Net {
  constructor() { this.socket = null; this.handlers = {}; this.online = false; this.name = null; }
  on(ev, fn) { this.handlers[ev] = fn; }
  _emit(ev, data) { if (this.handlers[ev]) this.handlers[ev](data); }

  connect(token) {
    this.disconnect();
    if (typeof window.io !== 'function') { this._emit('status', false); return; }
    const s = this.socket = window.io({ auth: { token: token || '' }, reconnectionAttempts: 5 });
    s.on('connect', () => { this.online = true; this._emit('status', true); });
    s.on('disconnect', () => { this.online = false; this._emit('status', false); });
    s.on('connect_error', () => { this.online = false; this._emit('status', false); });
    s.on('hello', (d) => { this.name = d.name; this._emit('hello', d); });
    for (const ev of ['chat:history', 'chat:msg', 'room:list', 'room:update', 'room:start', 'room:error', 'room:left', 'cmd'])
      s.on(ev, (d) => this._emit(ev, d));
  }
  disconnect() { if (this.socket) { this.socket.disconnect(); this.socket = null; } this.online = false; }
  send(ev, data) { if (this.socket && this.online) this.socket.emit(ev, data); }
}
