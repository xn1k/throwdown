// Throwdown UI: board rendering, input, timer, hints, save/restore.
import { generate, check, hint, HANDS, DIFFS, mulberry32, hashStr } from './core.js';

const $ = id => document.getElementById(id);
const SAVE = 'throwdown-v1';
let art = {};                 // sprite paths from assets/art/manifest.json (may be empty)
let G = null;                 // current game
let brush = 0;
let pendingHint = null;
let lastPlaced = -1;

// ---------------------------------------------------------------- sprites (with emoji fallback)

const handImg = (v, cls = '') => art[HANDS[v].id]
  ? `<img class="${cls}" src="${art[HANDS[v].id]}" alt="${HANDS[v].name}" draggable="false">`
  : `<span class="emo ${cls}">${HANDS[v].emoji}</span>`;
// animated sheet (4 square frames: normal, squash, stretch, blink) when the art has one
const handSprite = (v, cls = '') => art[HANDS[v].id + '_sheet']
  ? `<span class="spr ${cls}" role="img" aria-label="${HANDS[v].name}" style="background-image:url(${art[HANDS[v].id + '_sheet']})"></span>`
  : handImg(v, cls);
const blockImg = () => (art.block ? `<img src="${art.block}" alt="" draggable="false">` : '<span class="emo">\u{1F333}</span>');
const arrowSvg = () => art.arrow
  ? `<img src="${art.arrow}" alt="" draggable="false">`
  : '<svg viewBox="0 0 10 10" shape-rendering="crispEdges"><path d="M1 3h4v-2h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1v-2h-4z" fill="#f4c542" stroke="#1b1b2b" stroke-width=".7"/></svg>';

// ---------------------------------------------------------------- game state

function newGame(diff, seed, label) {
  const P = generate(seed, diff);
  const board = new Array(P.n).fill(-1);
  for (const i of P.open) if (P.given[i] >= 0) board[i] = P.given[i];
  G = { P, diff, seed, label, board, history: [], elapsed: 0, won: false, startedAt: Date.now() };
  pendingHint = null; lastPlaced = -1;
  setStatus('');
  layout(); save();
}

function save() {
  if (!G) return;
  try {
    localStorage.setItem(SAVE, JSON.stringify({
      diff: G.diff, seed: G.seed, label: G.label, board: G.board, elapsed: elapsed(), won: G.won, brush,
      stats: loadStats(),
    }));
  } catch { /* private mode: play on without saving */ }
}

function loadStats() {
  try { return JSON.parse(localStorage.getItem(SAVE + '-stats')) || {}; } catch { return {}; }
}
function saveStats(s) { try { localStorage.setItem(SAVE + '-stats', JSON.stringify(s)); } catch { /* ignore */ } }

function restore() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE)); } catch { /* ignore */ }
  if (!s || !DIFFS[s.diff]) return false;
  const P = generate(s.seed, s.diff);
  if (!P || !Array.isArray(s.board) || s.board.length !== P.n) return false;
  G = { P, diff: s.diff, seed: s.seed, label: s.label, board: s.board, history: [], elapsed: s.elapsed || 0,
        won: !!s.won, startedAt: Date.now() };
  for (const i of P.open) if (P.given[i] >= 0) G.board[i] = P.given[i];
  if (typeof s.brush === 'number') brush = s.brush;
  return true;
}

const elapsed = () => G.won ? G.elapsed : G.elapsed + (Date.now() - G.startedAt);
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(() => { if (G) $('timer').textContent = fmt(elapsed()); }, 500);
document.addEventListener('visibilitychange', () => {
  if (!G || G.won) return;
  if (document.hidden) { G.elapsed += Date.now() - G.startedAt; G.startedAt = Date.now(); G.paused = true; save(); }
  else if (G.paused) { G.startedAt = Date.now(); G.paused = false; }
});

// ---------------------------------------------------------------- rendering

let cs = 60;
function layout() {
  if (!G) return;
  const wrap = $('boardWrap').getBoundingClientRect();
  const { w, h } = G.P;
  cs = Math.max(28, Math.floor(Math.min((wrap.width - 20) / w, (wrap.height - 24) / h)));
  const b = $('board');
  b.style.setProperty('--cs', cs + 'px');
  b.style.width = w * cs + 'px';
  b.style.height = h * cs + 'px';
  render();
}
window.addEventListener('resize', layout);

function render() {
  const { P, board } = G;
  const res = check(P, board);
  const parts = [];
  for (let i = 0; i < P.n; i++) {
    const x = i % P.w, y = (i / P.w) | 0;
    const pos = `left:${x * cs}px;top:${y * cs}px`;
    if (P.blocked[i]) {
      parts.push(`<div class="sq block" style="${pos}${art.block_tile ? `;background-image:url(${art.block_tile})` : ''}"><div class="piece">${blockImg()}</div></div>`);
      continue;
    }
    const cls = ['sq'];
    if ((x + y) % 2) cls.push('alt');
    if (P.given[i] >= 0) cls.push('fixed');
    if (res.ties.has(i)) cls.push('tie');
    if (pendingHint && pendingHint.cell === i) cls.push(pendingHint.type === 'wrong' ? 'wrong' : 'hint');
    const tileArt = P.given[i] >= 0 ? art.tile_fixed : art.tile;
    const bg = tileArt ? `;background-image:url(${tileArt})` : '';
    const piece = board[i] >= 0 ? `<div class="piece${i === lastPlaced ? ' pop' : ''}">${handSprite(board[i], i === lastPlaced ? 'bounce' : '')}</div>` : '';
    const crown = art.crown ? `<img class="crown" src="${art.crown}" alt="">` : '';
    const badge = P.champ[i] >= 0 ? `<div class="badge${res.badChamps.has(i) ? ' bad' : ''}">${crown}${P.champ[i]}</div>` : '';
    const label = board[i] >= 0 ? HANDS[board[i]].name : 'empty';
    parts.push(`<div class="${cls.join(' ')}" data-i="${i}" role="gridcell" aria-label="${label}" style="${pos}${bg}">${piece}${badge}</div>`);
  }
  P.arrows.forEach(([a, b], k) => {
    const ax = a % P.w, ay = (a / P.w) | 0, bx = b % P.w, by = (b / P.w) | 0;
    const cx = ((ax + bx) / 2 + 0.5) * cs, cy = ((ay + by) / 2 + 0.5) * cs;
    const deg = bx > ax ? 0 : bx < ax ? 180 : by > ay ? 90 : -90;
    parts.push(`<div class="arrow${res.badArrows.has(k) ? ' bad' : ''}" style="left:${cx}px;top:${cy}px;transform:rotate(${deg}deg)">${arrowSvg()}</div>`);
  });
  if (G.won && art.sparkle) {
    const rnd = mulberry32(hashStr(G.seed));
    for (let k = 0; k < 7; k++) {
      parts.push(`<img class="sparkle" src="${art.sparkle}" alt="" style="left:${(rnd() * P.w * cs) | 0}px;top:${(rnd() * P.h * cs) | 0}px;animation-delay:${(rnd() * 1.2).toFixed(2)}s">`);
    }
  }
  const el = $('board');
  el.innerHTML = parts.join('');
  el.classList.toggle('won', G.won);
  $('label').textContent = G.label;
  $('timer').textContent = fmt(elapsed());
  lastPlaced = -1;
}

function renderPalette() {
  document.querySelectorAll('#palette button').forEach(btn => {
    const v = +btn.dataset.brush;
    if (v >= 0) btn.innerHTML = handSprite(v);
    btn.setAttribute('aria-pressed', String(v === brush));
  });
}

// ---------------------------------------------------------------- input

function place(i) {
  const { P, board } = G;
  if (G.won) return;
  if (P.given[i] >= 0) { toast(P.champ[i] >= 0 ? `Champion ${HANDS[P.given[i]].name}: beats ${P.champ[i]} neighbour${P.champ[i] === 1 ? '' : 's'}.` : 'This one was placed for you.'); return; }
  const next = board[i] === brush ? -1 : brush;
  if (next === board[i]) return;
  G.history.push([i, board[i]]);
  board[i] = next;
  if (next >= 0) lastPlaced = i;
  if (pendingHint && pendingHint.cell === i) { pendingHint = null; setStatus(''); }
  afterMove();
}

function afterMove() {
  const res = check(G.P, G.board);
  if (res.solved && !G.won) {
    G.elapsed = elapsed(); G.won = true;
    const st = loadStats(); const s = st[G.diff] || { solved: 0, best: null };
    s.solved++; if (s.best === null || G.elapsed < s.best) s.best = G.elapsed;
    st[G.diff] = s; saveStats(st);
    render(); save();
    setTimeout(() => showModal(`<h2>Victory!</h2><p>${G.label} solved in <b>${fmt(G.elapsed)}</b>.</p>
      <p>Best ${DIFFS[G.diff].name}: ${fmt(s.best)} &middot; solved ${s.solved}</p>`, 'Next puzzle', () => startNew(G.diff)), 1800);
    return;
  }
  if (res.ties.size) setStatus('Two of the same are touching. No ties allowed!');
  else if (res.badArrows.size) setStatus('An arrow points the wrong way: it goes from the winner to the loser.');
  else if (res.badChamps.size) setStatus('A champion has the wrong number of wins.');
  else if (!pendingHint) setStatus('');
  render(); save();
}

$('board').addEventListener('click', e => {
  const sq = e.target.closest('.sq[data-i]');
  if (sq) place(+sq.dataset.i);
});
$('palette').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  brush = +btn.dataset.brush; renderPalette(); save();
});
document.addEventListener('keydown', e => {
  if (!$('modal').hidden) { if (e.key === 'Enter' || e.key === 'Escape') $('modalClose').click(); return; }
  if (e.key === '1' || e.key === 'r') brush = 0;
  else if (e.key === '2' || e.key === 'p') brush = 1;
  else if (e.key === '3' || e.key === 's') brush = 2;
  else if (e.key === '0' || e.key === 'e') brush = -1;
  else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'u') { undo(); return; }
  else return;
  renderPalette();
});

function undo() {
  const last = G.history.pop();
  if (!last || G.won) return;
  G.board[last[0]] = last[1];
  afterMove();
}
$('undo').addEventListener('click', undo);
$('reset').addEventListener('click', () => {
  if (G.won) return;
  const { P } = G;
  if (!P.open.some(i => P.given[i] < 0 && G.board[i] >= 0)) return;
  showModal('<h2>Start over?</h2><p>All the hands you placed will be cleared.</p>', 'Clear the board', () => {
    for (const i of P.open) if (P.given[i] < 0) G.board[i] = -1;
    G.history = []; pendingHint = null; setStatus(''); render(); save();
  }, true);
});
$('hint').addEventListener('click', () => {
  if (G.won) return;
  // pressing Hint again on the same square fills it in
  if (pendingHint && pendingHint.type === 'step' && G.board[pendingHint.cell] < 0) {
    const { cell, value } = pendingHint;
    G.history.push([cell, -1]); G.board[cell] = value; lastPlaced = cell; pendingHint = null; setStatus('');
    afterMove(); return;
  }
  const h = hint(G.P, G.board);
  if (!h) return;
  pendingHint = h;
  if (h.type === 'wrong') setStatus('This one is wrong. Try another hand.');
  else if (h.type === 'whatif') setStatus(h.why);
  else setStatus(h.why + ' (Hint again to place it.)');
  render();
});

$('diff').innerHTML = Object.entries(DIFFS).map(([k, d]) => `<option value="${k}">${d.name}</option>`).join('');
$('diff').addEventListener('change', () => startNew($('diff').value));
$('new').addEventListener('click', () => startNew($('diff').value));
$('daily').addEventListener('click', () => {
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  $('diff').value = 'medium';
  newGame('medium', 'daily-' + key, 'Daily ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
});
$('help').addEventListener('click', showHelp);

function startNew(diff) {
  $('diff').value = diff;
  const seed = Math.random().toString(36).slice(2, 10);
  newGame(diff, seed, DIFFS[diff].name);
}

// ---------------------------------------------------------------- messages

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}
function setStatus(msg) { $('status').textContent = msg; }

let modalAction = null;
function showModal(html, button = 'OK', action = null, cancellable = false) {
  $('modalBody').innerHTML = html + (cancellable ? '<button id="modalCancel">Cancel</button>' : '');
  $('modalClose').textContent = button;
  modalAction = action;
  $('modal').hidden = false;
  if (cancellable) $('modalCancel').addEventListener('click', () => { modalAction = null; $('modal').hidden = true; });
}
$('modalClose').addEventListener('click', () => {
  $('modal').hidden = true;
  const a = modalAction; modalAction = null;
  if (a) a();
});

function showHelp() {
  const ico = v => handImg(v, 'ico');
  showModal(`<h2>How to play</h2>
    <div class="cycle">${ico(1)} beats ${ico(0)} beats ${ico(2)} beats ${ico(1)}</div>
    <ol>
      <li>Fill every empty square with ${ico(0)} Rock, ${ico(1)} Paper or ${ico(2)} Scissors. Trees stay empty.</li>
      <li><b>No ties:</b> two squares side by side can never hold the same thing.</li>
      <li><b>Arrows</b> point from the winner to the loser. ${ico(0)}&#x25B6;${ico(2)}</li>
      <li><b>Champions</b> have a gold number: how many of their neighbours they beat.</li>
    </ol>
    <p>Pick a hand at the bottom, then tap squares. Tap again to clear. Stuck? Press Hint.</p>`, 'Let\'s go');
}

// ---------------------------------------------------------------- start

async function boot() {
  try {
    const r = await fetch('assets/art/manifest.json', { cache: 'no-cache' });
    if (r.ok) art = await r.json();
  } catch { /* no art yet: emoji fallback */ }
  if (art.bg) document.body.style.backgroundImage = `url(${art.bg})`;
  renderPalette();
  const first = !localStorage.getItem(SAVE);
  if (restore()) $('diff').value = G.diff;
  else newGame('easy', Math.random().toString(36).slice(2, 10), DIFFS.easy.name);
  $('diff').value = G.diff;
  renderPalette();
  layout();
  if (first) showHelp();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
