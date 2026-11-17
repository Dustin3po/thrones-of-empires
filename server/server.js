'use strict';
/* THRONES OF EMPIRES - Servidor (Modulo 1): cuentas, ELO, chat y salas multijugador */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const SESSION_TTL = 7 * 24 * 3600 * 1000;
const CIVS = ['Britanos', 'Francos', 'Mongoles', 'Sarracenos', 'Vikingos', 'Bizantinos'];

/* ---------- Base de datos JSON con escritura atomica ---------- */
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (_) { /* primera ejecucion */ }
let saveTimer = null;
function saveDB() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), (err) => { if (!err) fs.rename(tmp, DB_FILE, () => {}); });
  }, 250);
}

/* ---------- Sesiones y limite de intentos ---------- */
const sessions = new Map(); // token -> { username, exp }
const attempts = new Map(); // ip -> { n, reset }
function newSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, exp: Date.now() + SESSION_TTL });
  return token;
}
function tooManyAttempts(ip) {
  const now = Date.now();
  const a = attempts.get(ip);
  if (!a || a.reset < now) { attempts.set(ip, { n: 1, reset: now + 60000 }); return false; }
  a.n++;
  return a.n > 12;
}
function userFromToken(token) {
  const s = sessions.get(token);
  if (!s || s.exp < Date.now()) return null;
  return db.users[s.username] || null;
}
const publicUser = (u) => ({
  username: u.displayName, elo: u.elo, wins: u.wins, losses: u.losses,
  favCiv: u.favCiv, history: u.history.slice(-20)
});

/* ---------- API HTTP ---------- */
const app = express();
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/register', async (req, res) => {
  try {
    if (tooManyAttempts(req.ip)) return res.status(429).json({ error: 'Demasiados intentos, espera un minuto' });
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(username))
      return res.status(400).json({ error: 'Usuario: 3-16 caracteres (letras, numeros, _)' });
    if (typeof password !== 'string' || password.length < 6 || password.length > 72)
      return res.status(400).json({ error: 'La contrasena debe tener entre 6 y 72 caracteres' });
    const key = username.toLowerCase();
    if (db.users[key]) return res.status(409).json({ error: 'Ese usuario ya existe' });
    db.users[key] = {
      displayName: username, hash: await bcrypt.hash(password, 10), elo: 1000,
      wins: 0, losses: 0, favCiv: CIVS[0], civCount: {}, history: [], created: Date.now()
    };
    saveDB();
    res.json({ token: newSession(key), user: publicUser(db.users[key]) });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    if (tooManyAttempts(req.ip)) return res.status(429).json({ error: 'Demasiados intentos, espera un minuto' });
    const { username, password } = req.body || {};
    const key = typeof username === 'string' ? username.toLowerCase() : '';
    const u = db.users[key];
    const ok = u && typeof password === 'string' && await bcrypt.compare(password, u.hash);
    if (!ok) return res.status(401).json({ error: 'Usuario o contrasena incorrectos' });
    res.json({ token: newSession(key), user: publicUser(u) });
  } catch (e) { res.status(500).json({ error: 'Error interno' }); }
});

function authMw(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const u = userFromToken(token);
  if (!u) return res.status(401).json({ error: 'Sesion invalida' });
  req.user = u;
  next();
}

app.get('/api/me', authMw, (req, res) => res.json({ user: publicUser(req.user) }));

/* Resultado de partida contra IA (ELO). Nota: en partidas online el resultado
   debera validarlo el servidor con la simulacion determinista (modulos futuros). */
app.post('/api/match-result', authMw, (req, res) => {
  const { result, opponentElo, civ } = req.body || {};
  if (!['win', 'loss'].includes(result)) return res.status(400).json({ error: 'Resultado invalido' });
  const opp = Math.min(3000, Math.max(400, Number(opponentElo) || 1000));
  const u = req.user;
  const expected = 1 / (1 + Math.pow(10, (opp - u.elo) / 400));
  const score = result === 'win' ? 1 : 0;
  u.elo = Math.round(u.elo + 32 * (score - expected));
  if (score) u.wins++; else u.losses++;
  if (CIVS.includes(civ)) {
    u.civCount[civ] = (u.civCount[civ] || 0) + 1;
    u.favCiv = Object.entries(u.civCount).sort((a, b) => b[1] - a[1])[0][0];
  }
  u.history.push({ t: Date.now(), result, civ: CIVS.includes(civ) ? civ : null, opponentElo: opp, elo: u.elo });
  if (u.history.length > 100) u.history.shift();
  saveDB();
  res.json({ user: publicUser(u) });
});

/* ---------- Socket.io: chat y salas ---------- */
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const rooms = new Map(); // id -> { id, name, hostId, seed, max, started, players:[{id,name}] }
const chatHistory = [];
let guestCounter = 1000;

io.use((socket, next) => {
  const u = userFromToken(socket.handshake.auth && socket.handshake.auth.token);
  socket.data.name = u ? u.displayName : 'Invitado' + (++guestCounter);
  socket.data.guest = !u;
  socket.data.lastChat = 0;
  next();
});

const roomList = () => [...rooms.values()].filter(r => !r.started).map(r => ({
  id: r.id, name: r.name, host: r.players[0] ? r.players[0].name : '', count: r.players.length, max: r.max
}));
const broadcastRooms = () => io.emit('room:list', roomList());
const roomInfo = (r) => ({ id: r.id, name: r.name, hostId: r.hostId, seed: r.seed, max: r.max, players: r.players });

function leaveRoom(socket) {
  const id = socket.data.room;
  if (!id) return;
  const r = rooms.get(id);
  socket.leave('room:' + id);
  socket.data.room = null;
  if (!r) return;
  r.players = r.players.filter(p => p.id !== socket.id);
  if (!r.players.length) rooms.delete(id);
  else {
    if (r.hostId === socket.id) r.hostId = r.players[0].id;
    io.to('room:' + id).emit('room:update', roomInfo(r));
    if (r.started) io.to('room:' + id).emit('room:left', { name: socket.data.name });
  }
  broadcastRooms();
}

io.on('connection', (socket) => {
  socket.emit('hello', { name: socket.data.name, guest: socket.data.guest });
  socket.emit('chat:history', chatHistory);
  socket.emit('room:list', roomList());

  socket.on('chat:send', (msg) => {
    const now = Date.now();
    if (now - socket.data.lastChat < 400) return;
    socket.data.lastChat = now;
    if (!msg || typeof msg.text !== 'string') return;
    const text = msg.text.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
    if (!text) return;
    const out = { channel: msg.channel === 'sala' ? 'sala' : 'global', from: socket.data.name, text, t: now };
    if (out.channel === 'sala') {
      if (socket.data.room) io.to('room:' + socket.data.room).emit('chat:msg', out);
    } else {
      chatHistory.push(out);
      if (chatHistory.length > 50) chatHistory.shift();
      io.emit('chat:msg', out);
    }
  });

  socket.on('room:create', (data) => {
    leaveRoom(socket);
    const id = crypto.randomBytes(4).toString('hex');
    const name = String((data && data.name) || socket.data.name + ' - sala').slice(0, 30);
    const r = { id, name, hostId: socket.id, seed: crypto.randomInt(1, 2 ** 31 - 1), max: 4, started: false,
      players: [{ id: socket.id, name: socket.data.name }] };
    rooms.set(id, r);
    socket.join('room:' + id);
    socket.data.room = id;
    socket.emit('room:update', roomInfo(r));
    broadcastRooms();
  });

  socket.on('room:join', (id) => {
    const r = rooms.get(id);
    if (!r || r.started || r.players.length >= r.max) return socket.emit('room:error', 'La sala no esta disponible');
    leaveRoom(socket);
    r.players.push({ id: socket.id, name: socket.data.name });
    socket.join('room:' + id);
    socket.data.room = id;
    io.to('room:' + id).emit('room:update', roomInfo(r));
    broadcastRooms();
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('room:start', () => {
    const r = rooms.get(socket.data.room);
    if (!r || r.hostId !== socket.id || r.started) return;
    r.started = true;
    io.to('room:' + r.id).emit('room:start', { seed: r.seed, players: r.players, roomId: r.id });
    broadcastRooms();
  });

  /* Relevo de comandos (base del netcode determinista por turnos) */
  socket.on('cmd', (cmd) => {
    const r = rooms.get(socket.data.room);
    if (!r || !r.started || typeof cmd !== 'object' || cmd === null) return;
    socket.to('room:' + r.id).emit('cmd', { from: socket.id, cmd });
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

server.listen(PORT, () => console.log('THRONES OF EMPIRES en http://localhost:' + PORT));
