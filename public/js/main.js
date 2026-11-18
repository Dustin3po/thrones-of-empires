import * as THREE from 'three';
import { Terrain, ChunkManager } from './terrain.js';
import { Water } from './water.js';
import { Atmosphere } from './atmosphere.js';
import { PostFX } from './postfx.js';
import { RTSCamera } from './camera.js';
import { Minimap } from './minimap.js';
import { Net, api } from './net.js';

const $ = (s) => document.querySelector(s);
const CIVS = ['Britanos', 'Francos', 'Mongoles', 'Sarracenos', 'Vikingos', 'Bizantinos'];
const TIPS = ['Pulsa H para centrar la cámara en tu base.', 'Ctrl+1..9 guarda una posición de cámara; pulsa el número para volver.',
  'Arrastra sobre el minimapa para desplazarte por el mapa inmenso.', 'Usa Q/E o el botón central del ratón para rotar la vista.'];
const state = { user: null, token: null, guest: false, game: null, room: null, civ: CIVS[0] };
const net = new Net();

try { state.token = localStorage.getItem('toe_token'); } catch (_) { /* almacenamiento no disponible */ }

/* ---------- Pantallas ---------- */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  if (id) $('#screen-' + id).classList.add('active');
  $('#hud').classList.toggle('hidden', id !== null);
}
CIVS.forEach(c => { const o = document.createElement('option'); o.textContent = c; $('#sk-civ').appendChild(o); });
const randSeed = () => Math.floor(Math.random() * 2 ** 31);
$('#sk-seed').value = randSeed();
$('#sk-rand').onclick = () => { $('#sk-seed').value = randSeed(); };

/* ---------- Autenticacion ---------- */
let authMode = 'login';
document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
  authMode = t.dataset.tab;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  $('#auth-submit').textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
  $('#auth-error').textContent = '';
});
async function submitAuth() {
  $('#auth-error').textContent = '';
  try {
    const d = await api('/api/' + authMode, 'POST', { username: $('#auth-user').value.trim(), password: $('#auth-pass').value });
    state.token = d.token; state.user = d.user; state.guest = false;
    try { localStorage.setItem('toe_token', d.token); } catch (_) { /* ignorar */ }
    enterMenu();
  } catch (e) { $('#auth-error').textContent = e.message; }
}
$('#auth-submit').onclick = submitAuth;
$('#auth-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });
$('#auth-guest').onclick = () => { state.user = null; state.token = null; state.guest = true; enterMenu(); };
$('#btn-logout').onclick = () => {
  try { localStorage.removeItem('toe_token'); } catch (_) { /* ignorar */ }
  state.user = null; state.token = null; net.disconnect(); show('login');
};

function renderProfile() {
  const u = state.user;
  $('#profile').innerHTML = u
    ? `<b>${esc(u.username)}</b><br>ELO: ${u.elo}<br>Victorias: ${u.wins} · Derrotas: ${u.losses}<br>Civilización favorita: ${esc(u.favCiv)}`
    : 'Invitado: inicia sesión para guardar ELO e historial.';
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function enterMenu() {
  renderProfile(); show('menu'); net.connect(state.token);
}
net.on('status', (ok) => {
  $('#net-status').textContent = ok ? '● Servidor conectado' : '○ Sin servidor: modo escaramuza offline disponible';
  $('#btn-multi').disabled = !ok;
});
net.on('hello', (d) => addChat('sistema', 'Sistema', 'Conectado como ' + d.name));

/* ---------- Lobby ---------- */
$('#btn-multi').onclick = () => show('lobby');
$('#lobby-back').onclick = () => { net.send('room:leave'); state.room = null; renderRoom(); show('menu'); };
$('#room-create').onclick = () => net.send('room:create', {});
$('#room-leave').onclick = () => { net.send('room:leave'); state.room = null; renderRoom(); };
$('#room-start').onclick = () => net.send('room:start');
net.on('room:list', (list) => {
  const ul = $('#room-list'); ul.innerHTML = '';
  if (!list.length) ul.innerHTML = '<li>No hay salas abiertas</li>';
  list.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${esc(r.name)} (${r.count}/${r.max})</span>`;
    const b = document.createElement('button'); b.className = 'btn mini'; b.textContent = 'Unirse';
    b.onclick = () => net.send('room:join', r.id);
    li.appendChild(b); ul.appendChild(li);
  });
});
net.on('room:update', (r) => { state.room = r; renderRoom(); });
net.on('room:error', (m) => alert(m));
function renderRoom() {
  const r = state.room;
  $('#room-title').textContent = r ? r.name : 'Sin sala';
  const ul = $('#room-players'); ul.innerHTML = '';
  if (r) r.players.forEach(p => { const li = document.createElement('li'); li.textContent = p.name + (p.id === r.hostId ? ' 👑' : ''); ul.appendChild(li); });
  $('#room-start').disabled = !(r && net.socket && r.hostId === net.socket.id);
}
net.on('room:start', (d) => startGame({ seed: d.seed, mode: 'online', roomId: d.roomId }));
net.on('room:left', (d) => addChat('sistema', 'Sistema', d.name + ' abandonó la partida'));

/* ---------- Chat ---------- */
const chat = { ch: 'global', logs: { global: [], sala: [], sistema: [] }, unread: {} };
function addChat(ch, from, text) {
  chat.logs[ch].push({ from, text });
  if (chat.logs[ch].length > 100) chat.logs[ch].shift();
  if (ch === chat.ch) renderChat(); else { chat.unread[ch] = true; markTabs(); }
}
function renderChat() {
  const log = $('#chat-log');
  log.innerHTML = chat.logs[chat.ch].map(m => m.from === 'Sistema'
    ? `<div class="sys">${esc(m.text)}</div>` : `<div class="m"><b>${esc(m.from)}:</b> ${esc(m.text)}</div>`).join('');
  log.scrollTop = log.scrollHeight; markTabs();
}
function markTabs() {
  document.querySelectorAll('.chat-tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.ch === chat.ch);
    b.classList.toggle('unread', !!chat.unread[b.dataset.ch] && b.dataset.ch !== chat.ch);
  });
}
document.querySelectorAll('.chat-tabs button').forEach(b => b.onclick = () => { chat.ch = b.dataset.ch; chat.unread[chat.ch] = false; renderChat(); });
net.on('chat:history', (h) => { chat.logs.global = h.map(m => ({ from: m.from, text: m.text })); renderChat(); });
net.on('chat:msg', (m) => addChat(m.channel, m.from, m.text));
function sendChat() {
  const input = $('#chat-input'), text = input.value.trim();
  input.value = '';
  if (!text || chat.ch === 'sistema') return;
  if (net.online) net.send('chat:send', { channel: chat.ch, text });
  else addChat(chat.ch, state.user ? state.user.username : 'Tú', text.slice(0, 200));
}
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { sendChat(); $('#chat-input').blur(); e.stopPropagation(); }
  if (e.key === 'Escape') $('#chat-input').blur();
});

/* ---------- Juego ---------- */
const canvas = $('#game');
let renderer = null;
const QUALITY = {
  low:  { pr: () => 1, shadow: 1024, post: false, bloom: false },
  med:  { pr: () => Math.min(devicePixelRatio, 1.5), shadow: 2048, post: true, bloom: true },
  high: { pr: () => Math.min(devicePixelRatio, 2), shadow: 4096, post: true, bloom: true }
};
try { state.quality = localStorage.getItem('toe_quality'); } catch (_) { /* ignorar */ }
if (!QUALITY[state.quality]) state.quality = 'med';
$('#quality').value = state.quality;
$('#quality').onchange = (e) => applyQuality(e.target.value);

function applyQuality(level) {
  state.quality = level;
  try { localStorage.setItem('toe_quality', level); } catch (_) { /* ignorar */ }
  const q = QUALITY[level];
  if (renderer) { renderer.setPixelRatio(q.pr()); renderer.setSize(innerWidth, innerHeight, false); }
  const g = state.game; if (!g) return;
  g.sun.shadow.mapSize.set(q.shadow, q.shadow);
  if (g.sun.shadow.map) { g.sun.shadow.map.dispose(); g.sun.shadow.map = null; }
  g.post.configure(q.post, q.bloom);
  g.post.setSize(innerWidth, innerHeight);
}

function ensureRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(QUALITY[state.quality].pr());
  renderer.setSize(innerWidth, innerHeight, false);   // corrige el lienzo borroso del Modulo 1
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}
const setProgress = (p, t) => { $('#load-bar').style.width = Math.round(p * 100) + '%'; if (t) $('#load-text').textContent = t; };
const tick = () => new Promise(r => setTimeout(r));

async function startGame({ seed, mode, civ }) {
  if (state.game) stopGame();
  show('loading'); $('#load-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  setProgress(0, 'Generando el mundo…'); await tick();
  const r = ensureRenderer();
  const scene = new THREE.Scene();                       // sin niebla en el mundo 3D
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 2600);
  const terrain = new Terrain(seed >>> 0);
  const spawn = terrain.findSpawn(0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 1, far: 600 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  const atmo = new Atmosphere(scene, sun, hemi, r);

  setProgress(0.02, 'Forjando texturas procedurales…'); await tick();
  const chunks = new ChunkManager(scene, terrain);
  const rig = new RTSCamera(camera, canvas, terrain);
  rig.focus(spawn.x, spawn.z); rig.target.y = terrain.heightAt(spawn.x, spawn.z);

  const mm = new Minimap($('#minimap'), terrain, 384);
  await mm.buildTerrain((p) => setProgress(0.05 + p * 0.4, 'Cartografiando el mapa táctico…'));
  mm.addSource('base', spawn.x, spawn.z, 130);
  mm.addSource('cam', spawn.x, spawn.z, 60);
  mm.setMarker('base', spawn.x, spawn.z, '#f7d24a');
  mm.onPick = (x, z) => rig.focus(x, z);

  const water = new Water(scene, mm.heights, mm.S, atmo);
  const post = new PostFX(r, scene, camera);

  // Pre-construir los chunks cercanos con barra de progreso
  let guard = 0;
  while (guard++ < 400) {
    const pending = chunks.update(spawn.x, spawn.z, 4);
    setProgress(0.45 + 0.55 * Math.max(0, 1 - pending / 220), 'Levantando el terreno…');
    await tick();
    if (!pending) break;
  }
  rig.onCenterBase = () => rig.focus(spawn.x, spawn.z);

  const res = { food: 200, wood: 200, gold: 100, stone: 200, infl: 0 };
  const u = state.user;
  $('#hud-name').textContent = u ? u.username : 'Invitado';
  $('#hud-level').textContent = u ? `ELO ${u.elo}` : 'Sin clasificar';
  $('#hud-xp').style.width = u ? Math.min(100, (u.wins * 10) % 100) + '%' : '0%';
  for (const k of Object.keys(res)) $('#r-' + k).textContent = res[k];

  const g = state.game = { scene, camera, terrain, chunks, rig, mm, sun, hemi, atmo, water, post, spawn, paused: false, raf: 0,
    last: performance.now(), time: 0, fps: 0, acc: 0, frames: 0, mode, civ };
  applyQuality(state.quality);
  show(null); renderChat();
  addChat('sistema', 'Sistema', `Partida ${mode === 'online' ? 'online' : 'de escaramuza'} iniciada. Semilla: ${seed}. T: ciclo día/noche · N: cambiar hora.`);
  const loop = (now) => {
    g.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - g.last) / 1000); g.last = now;
    if (!g.paused) {
      g.time += dt;
      rig.enabled = document.activeElement !== $('#chat-input');
      rig.update(dt);
      const t = rig.target;
      chunks.update(t.x, t.z, 2);
      atmo.update(dt, t, camera);
      water.update(t.x, t.z, g.time, atmo);
      chunks.uniforms.uTime.value = g.time; chunks.uniforms.uSunI.value = atmo.day;
      mm.updateSource('cam', t.x, t.z);
    }
    post.render(dt);
    mm.draw(camera);
    g.acc += dt; g.frames++;
    if (g.acc > 0.5) { g.fps = Math.round(g.frames / g.acc); g.acc = 0; g.frames = 0; }
    $('#coords').textContent = `X ${Math.round(rig.target.x)}  Z ${Math.round(rig.target.z)}  ·  ${atmo.label()}  ·  ${g.fps} FPS  ·  ${chunks.chunks.size} chunks`;
  };
  g.raf = requestAnimationFrame(loop);
}

function stopGame() {
  const g = state.game; if (!g) return;
  cancelAnimationFrame(g.raf);
  g.post.dispose(); g.water.dispose(); g.atmo.dispose(); g.chunks.dispose(); g.rig.dispose();
  state.game = null;
}
addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight, false);
  const g = state.game;
  if (g) { g.camera.aspect = innerWidth / innerHeight; g.camera.updateProjectionMatrix(); g.post.setSize(innerWidth, innerHeight); }
});

$('#btn-skirmish').onclick = () => {
  const seed = parseInt($('#sk-seed').value, 10) || randSeed();
  state.civ = $('#sk-civ').value;
  startGame({ seed, mode: 'skirmish', civ: state.civ });
};

/* ---------- Acciones HUD, pausa y atajos globales ---------- */
function togglePause(force) {
  const g = state.game; if (!g) return;
  g.paused = force !== undefined ? force : !g.paused;
  $('#pause').classList.toggle('active', g.paused);
}
document.querySelectorAll('#actionbar .round').forEach(b => b.onclick = () => {
  const g = state.game; if (!g) return;
  ({
    base: () => g.rig.focus(g.spawn.x, g.spawn.z),
    rotl: () => { g.rig.yaw += 0.35; }, rotr: () => { g.rig.yaw -= 0.35; },
    zin: () => { g.rig.zoomVel -= 0.05; }, zout: () => { g.rig.zoomVel += 0.05; },
    chat: () => $('#chat-input').focus(), menu: () => togglePause()
  })[b.dataset.act]();
});
$('#pause-resume').onclick = () => togglePause(false);
$('#pause-exit').onclick = () => { togglePause(false); stopGame(); enterMenu(); };
addEventListener('keydown', (e) => {
  if (!state.game) return;
  if (e.key === 'Enter' && document.activeElement !== $('#chat-input')) { e.preventDefault(); $('#chat-input').focus(); }
  else if (e.key === 'Escape' && document.activeElement !== $('#chat-input')) togglePause();
  else if (document.activeElement !== $('#chat-input') && !state.game.paused) {
    const a = state.game.atmo, k = e.key.toLowerCase();
    if (k === 't') { a.auto = !a.auto; addChat('sistema', 'Sistema', a.auto ? 'Ciclo día/noche activado' : 'Ciclo día/noche detenido'); }
    if (k === 'n') { a.time = (a.time + 0.125) % 1; addChat('sistema', 'Sistema', 'Hora: ' + a.label()); }
  }
});

/* ---------- Arranque: restaurar sesion si existe ---------- */
(async function boot() {
  if (state.token) {
    try { state.user = (await api('/api/me', 'GET', null, state.token)).user; enterMenu(); return; }
    catch (_) { state.token = null; try { localStorage.removeItem('toe_token'); } catch (__) { /* ignorar */ } }
  }
  show('login');
})();
