// Throwdown core: square grid, rock-paper-scissors rules, logic solver and generator.
// Pure logic, runs in the browser and in node.
//
// Rules of a puzzle:
//  1. Every open square holds Rock, Paper or Scissors. Boulders stay empty.
//  2. No ties: two squares that touch side by side never hold the same hand,
//     so every touching pair is a duel that someone wins.
//  3. An arrow between two squares points from the winner of that duel to the loser.
//  4. A champion is a pre-placed hand with a number: how many of its neighbours it beats.
//  Plain pre-placed hands are just givens.

export const HANDS = [
  { id: 'rock',     name: 'Rock',     emoji: '\u{1FAA8}', color: '#8f8a83' },
  { id: 'paper',    name: 'Paper',    emoji: '\u{1F4DC}', color: '#efe4c4' },
  { id: 'scissors', name: 'Scissors', emoji: '✂️', color: '#d35d5d' },
];
// 0 = rock, 1 = paper, 2 = scissors. Each hand beats the one before it (paper > rock, ...).
export const prey = v => (v + 2) % 3;      // the hand v beats
export const pred = v => (v + 1) % 3;      // the hand that beats v
export const beats = (a, b) => prey(a) === b;

const bit = v => 1 << v;
const toPrey = m => ((m << 2) | (m >> 1)) & 7;   // {v} -> {prey(v)}
const toPred = m => ((m << 1) | (m >> 2)) & 7;   // {v} -> {pred(v)}
const ONE = [-1, 0, 1, -1, 2, -1, -1, -1];        // mask -> its only value, or -1
const COUNT = [0, 1, 1, 2, 1, 2, 2, 3];

export const DIFFS = {
  easy:   { name: 'Easy',   w: 5, h: 5, blocks: [1, 3], level: 0, weights: { given: 3, champ: 2, arrow: 3 } },
  medium: { name: 'Medium', w: 6, h: 6, blocks: [2, 4], level: 0, weights: { given: 2, champ: 3, arrow: 4 } },
  hard:   { name: 'Hard',   w: 7, h: 7, blocks: [3, 6], level: 1, needLookahead: true, weights: { given: 1, champ: 3, arrow: 4 } },
  expert: { name: 'Expert', w: 8, h: 8, blocks: [4, 8], level: 1, needLookahead: true, weights: { given: 1, champ: 2, arrow: 3 } },
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------- grid

// blocked: array of 0/1 per square. Returns the static part of a puzzle.
export function makeGrid(w, h, blocked) {
  const n = w * h;
  const open = [], nb = [], edges = [];
  for (let i = 0; i < n; i++) {
    nb.push([]);
    if (!blocked[i]) open.push(i);
  }
  for (const i of open) {
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (blocked[j]) continue;
      nb[i].push(j);
      if (j > i) edges.push([i, j]);
    }
  }
  return { w, h, n, blocked: Array.from(blocked), open, nb, edges };
}

// A puzzle = grid + clues. given[i] = hand or -1, champ[i] = number or -1, arrows = [[winner, loser]].
export function makePuzzle(grid, clues, solution) {
  const given = new Array(grid.n).fill(-1), champ = new Array(grid.n).fill(-1), arrows = [];
  for (const c of clues) {
    if (c.t === 'given') given[c.i] = solution[c.i];
    else if (c.t === 'champ') { given[c.i] = solution[c.i]; champ[c.i] = c.k; }
    else arrows.push([c.a, c.b]);
  }
  const champList = [];
  for (let i = 0; i < grid.n; i++) if (champ[i] >= 0) champList.push(i);
  return { ...grid, given, champ, champList, arrows, solution };
}

export function initMasks(P) {
  const m = new Array(P.n).fill(0);
  for (const i of P.open) m[i] = P.given[i] >= 0 ? bit(P.given[i]) : 7;
  return m;
}

// ---------------------------------------------------------------- solver

// Basic deductions until nothing changes. Returns false on a contradiction.
export function propagate(P, m) {
  const { open, nb, arrows, champList, champ } = P;
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of open) {
      const v = ONE[m[i]];
      if (v < 0) { if (!m[i]) return false; continue; }
      const b = bit(v);
      for (const j of nb[i]) if (m[j] & b) { m[j] &= ~b; if (!m[j]) return false; changed = true; }
    }
    for (const [a, b] of arrows) {
      const mb = m[b] & toPrey(m[a]);
      if (mb !== m[b]) { if (!mb) return false; m[b] = mb; changed = true; }
      const ma = m[a] & toPred(m[b]);
      if (ma !== m[a]) { if (!ma) return false; m[a] = ma; changed = true; }
    }
    for (const c of champList) {
      const v = ONE[m[c]];
      if (v < 0) return false;
      const pb = bit(prey(v)), k = champ[c];
      let sure = 0, poss = 0;
      for (const j of nb[c]) if (m[j] & pb) { poss++; if (m[j] === pb) sure++; }
      if (sure > k || poss < k) return false;
      if (sure === k && poss > k) {
        for (const j of nb[c]) if ((m[j] & pb) && m[j] !== pb) { m[j] &= ~pb; changed = true; }
      } else if (poss === k && sure < k) {
        for (const j of nb[c]) if (m[j] & pb) { m[j] = pb; changed = true; }
      }
    }
  }
  return true;
}

const isDone = (P, m) => P.open.every(i => ONE[m[i]] >= 0);

// Human-style solve. level 0 = basic deductions only, level 1 = also "what if" one step deep.
// Returns { ok, lookaheads, m }.
export function logicSolve(P, level, m = initMasks(P)) {
  if (!propagate(P, m)) return { ok: false, m };
  let lookaheads = 0;
  while (!isDone(P, m)) {
    if (level < 1) return { ok: false, m };
    let progress = false;
    for (const i of P.open) {
      if (ONE[m[i]] >= 0) continue;
      for (let v = 0; v < 3; v++) {
        if (!(m[i] & bit(v))) continue;
        const t = m.slice(); t[i] = bit(v);
        if (!propagate(P, t)) {
          m[i] &= ~bit(v); lookaheads++; progress = true;
          if (!propagate(P, m)) return { ok: false, m };
        }
      }
      if (progress) break;
    }
    if (!progress) return { ok: false, m };
  }
  return { ok: true, lookaheads, m };
}

// Full search; returns up to `limit` solutions (arrays of hands, -1 on boulders).
export function solve(P, limit = 2) {
  const out = [];
  const rec = m => {
    if (out.length >= limit) return;
    if (!propagate(P, m)) return;
    let best = -1, bc = 4;
    for (const i of P.open) { const c = COUNT[m[i]]; if (c > 1 && c < bc) { bc = c; best = i; } }
    if (best < 0) { out.push(m.map((x, i) => (P.blocked[i] ? -1 : ONE[x]))); return; }
    for (let v = 0; v < 3; v++) if (m[best] & bit(v)) { const t = m.slice(); t[best] = bit(v); rec(t); }
  };
  rec(initMasks(P));
  return out;
}

// ---------------------------------------------------------------- checking a player's board

// board[i] = hand or -1. Returns which squares/arrows/champions break a rule, and whether it is solved.
export function check(P, board) {
  const ties = new Set(), badArrows = new Set(), badChamps = new Set();
  let filled = true;
  for (const i of P.open) {
    if (board[i] < 0) { filled = false; continue; }
    for (const j of P.nb[i]) if (board[j] === board[i]) { ties.add(i); ties.add(j); }
  }
  P.arrows.forEach(([a, b], k) => {
    if (board[a] >= 0 && board[b] >= 0 && !beats(board[a], board[b])) badArrows.add(k);
  });
  for (const c of P.champList) {
    let wins = 0, empty = 0;
    for (const j of P.nb[c]) { if (board[j] < 0) empty++; else if (beats(board[c], board[j])) wins++; }
    if (wins > P.champ[c] || wins + empty < P.champ[c]) badChamps.add(c);
  }
  const solved = filled && !ties.size && !badArrows.size && !badChamps.size;
  return { ties, badArrows, badChamps, filled, solved };
}

// ---------------------------------------------------------------- hints

const nm = v => HANDS[v].name;
const a_ = v => (v === 0 ? 'a Rock' : v === 1 ? 'a Paper' : 'a Scissors');

// Next step for the player: a wrong hand to fix, or a square whose hand can be worked out (with a reason).
export function hint(P, board) {
  for (const i of P.open) if (board[i] >= 0 && board[i] !== P.solution[i]) return { type: 'wrong', cell: i };
  const val = i => (board[i] >= 0 ? board[i] : P.given[i]);
  const empty = P.open.filter(i => val(i) < 0);
  if (!empty.length) return null;
  // 1. touches two different hands -> the third one
  for (const i of empty) {
    const seen = new Set(P.nb[i].map(val).filter(v => v >= 0));
    if (seen.size === 2) {
      const [x, y] = [...seen], v = 3 - x - y;
      return { type: 'step', cell: i, value: v, why: `It touches ${a_(x)} and ${a_(y)}. No ties allowed, so it must be ${a_(v)}.` };
    }
  }
  // 2. an arrow with one end known
  for (const [a, b] of P.arrows) {
    if (val(a) >= 0 && val(b) < 0) return { type: 'step', cell: b, value: prey(val(a)), why: `The arrow says the ${nm(val(a))} wins here, and ${nm(val(a))} beats ${nm(prey(val(a)))}.` };
    if (val(b) >= 0 && val(a) < 0) return { type: 'step', cell: a, value: pred(val(b)), why: `The arrow says this square beats the ${nm(val(b))}. Only ${nm(pred(val(b)))} beats ${nm(val(b))}.` };
  }
  // 3. a champion that has all its wins, or needs every open neighbour
  for (const c of P.champList) {
    const v = P.given[c], k = P.champ[c];
    let wins = 0; const open = [];
    for (const j of P.nb[c]) { if (val(j) < 0) open.push(j); else if (beats(v, val(j))) wins++; }
    if (!open.length) continue;
    if (wins === k) return { type: 'step', cell: open[0], value: pred(v), why: `The ${nm(v)} champion already has its ${k} win${k === 1 ? '' : 's'}, so this neighbour must beat it: ${a_(pred(v))}.` };
    if (wins + open.length === k) return { type: 'step', cell: open[0], value: prey(v), why: `The ${nm(v)} champion needs ${k} win${k === 1 ? '' : 's'} and only has enough neighbours left if this one loses: ${a_(prey(v))}.` };
  }
  // 4. the solver's own next deduction
  const m = initMasks(P);
  for (const i of P.open) if (board[i] >= 0) m[i] = bit(board[i]);
  const basic = m.slice();
  propagate(P, basic);
  const easy = empty.find(i => ONE[basic[i]] >= 0);
  if (easy !== undefined) return { type: 'step', cell: easy, value: ONE[basic[easy]], why: `Only ${a_(ONE[basic[easy]])} fits here. Look at its neighbours, arrows and champions nearby.` };
  for (const i of empty) for (let v = 0; v < 3; v++) {
    if (!(basic[i] & bit(v))) continue;
    const t = basic.slice(); t[i] = bit(v);
    if (!propagate(P, t)) return { type: 'whatif', cell: i, value: v, why: `What if this were ${a_(v)}? Follow it through and something breaks. So it is not ${a_(v)}.` };
  }
  const i = empty[0];
  return { type: 'step', cell: i, value: P.solution[i], why: `This one is tricky. It is ${a_(P.solution[i])}.` };
}

// ---------------------------------------------------------------- generator

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function connected(grid) {
  if (!grid.open.length) return false;
  const seen = new Set([grid.open[0]]), stack = [grid.open[0]];
  while (stack.length) for (const j of grid.nb[stack.pop()]) if (!seen.has(j)) { seen.add(j); stack.push(j); }
  return seen.size === grid.open.length && grid.open.every(i => grid.nb[i].length > 0);
}

function makeBlocks(w, h, count, rnd) {
  for (let tries = 0; tries < 200; tries++) {
    const blocked = new Array(w * h).fill(0);
    let placed = 0;
    while (placed < count) {
      const i = (rnd() * w * h) | 0, j = w * h - 1 - i;    // point symmetry looks tidy
      if (blocked[i]) continue;
      blocked[i] = blocked[j] = 1;
      placed += i === j ? 1 : 2;
    }
    const grid = makeGrid(w, h, blocked);
    if (connected(grid)) return grid;
  }
  return makeGrid(w, h, new Array(w * h).fill(0));
}

function colour(grid, rnd) {
  const sol = new Array(grid.n).fill(-1);
  for (const i of grid.open) {
    const banned = new Set(grid.nb[i].map(j => sol[j]));
    const ok = [0, 1, 2].filter(v => !banned.has(v));
    sol[i] = ok[(rnd() * ok.length) | 0];
  }
  return sol;
}

const solvable = (grid, clues, sol, level) => logicSolve(makePuzzle(grid, clues, sol), level).ok;

export function generate(seed, diff = 'medium') {
  const D = DIFFS[diff];
  const rnd = mulberry32(hashStr(seed + '|' + diff));
  let fallback = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const count = D.blocks[0] + ((rnd() * (D.blocks[1] - D.blocks[0] + 1)) | 0);
    const grid = makeBlocks(D.w, D.h, count, rnd);
    const sol = colour(grid, rnd);

    // every possible clue, in a weighted random order
    const pool = [];
    for (const i of grid.open) {
      pool.push({ t: 'given', i });
      const k = grid.nb[i].filter(j => beats(sol[i], sol[j])).length;
      pool.push({ t: 'champ', i, k });
    }
    for (const [i, j] of grid.edges) pool.push(beats(sol[i], sol[j]) ? { t: 'arrow', a: i, b: j } : { t: 'arrow', a: j, b: i });
    for (const c of pool) c.r = Math.pow(rnd(), 1 / D.weights[c.t]);
    pool.sort((x, y) => y.r - x.r);

    // add until solvable, then strip everything that is not needed
    let clues = [];
    for (const c of pool) {
      if (c.t !== 'arrow' && clues.some(d => d.i === c.i && d.t !== 'arrow')) continue;   // one given/champion per square
      clues.push(c);
      if (clues.length >= 6 && solvable(grid, clues, sol, D.level)) break;
    }
    if (!solvable(grid, clues, sol, D.level)) continue;
    for (const c of shuffle(clues.slice(), rnd)) {
      const rest = clues.filter(d => d !== c);
      if (solvable(grid, rest, sol, D.level)) clues = rest;
      else if (c.t === 'champ') {      // try demoting a champion to a plain given
        const g = { t: 'given', i: c.i };
        const alt = rest.concat(g);
        if (solvable(grid, alt, sol, D.level)) clues = alt;
      }
    }
    const P = makePuzzle(grid, clues, sol);
    P.seed = seed; P.diff = diff;
    const needs = logicSolve(makePuzzle(grid, clues, sol), 1);
    P.lookaheads = needs.lookaheads;
    if (D.needLookahead && logicSolve(makePuzzle(grid, clues, sol), 0).ok) { fallback = fallback || P; continue; }
    if (!P.champList.length && attempt < 30) { fallback = fallback || P; continue; }
    return P;
  }
  return fallback;
}
