// node tools/test.mjs  - generator/solver smoke test and stats
import { generate, solve, check, hint, logicSolve, DIFFS } from '../js/core.js';

let fail = 0;
const N = +(process.argv[2] || 30);
for (const diff of Object.keys(DIFFS)) {
  const st = { given: 0, champ: 0, arrow: 0, ms: 0, la: 0, maxMs: 0, easyHard: 0 };
  for (let i = 0; i < N; i++) {
    const t = Date.now();
    const P = generate('test' + i, diff);
    const dt = Date.now() - t;
    st.ms += dt; st.maxMs = Math.max(st.maxMs, dt);
    if (!P) { console.log('FAIL no puzzle', diff, i); fail++; continue; }
    const sols = solve(P, 3);
    if (sols.length !== 1) { console.log('FAIL not unique', diff, i, sols.length); fail++; }
    if (!check(P, P.solution).solved) { console.log('FAIL solution rejected', diff, i); fail++; }
    const part = P.solution.slice(); part[P.open[0]] = -1;
    if (check(P, part).solved) { console.log('FAIL partial accepted'); fail++; }
    if (JSON.stringify(generate('test' + i, diff).solution) !== JSON.stringify(P.solution)) { console.log('FAIL not deterministic'); fail++; }
    if (DIFFS[diff].needLookahead && logicSolve(P, 0).ok) st.easyHard++;
    // play it out with hints only: every hint must be correct and the game must finish
    const board = new Array(P.n).fill(-1);
    for (const j of P.open) if (P.given[j] >= 0) board[j] = P.given[j];
    for (let s = 0; s < P.n; s++) {
      const h = hint(P, board);
      if (!h) break;
      if (h.value !== undefined && h.type === 'step') {
        if (h.value !== P.solution[h.cell]) { console.log('FAIL wrong hint', diff, i, h); fail++; break; }
        board[h.cell] = h.value;
      } else if (h.type === 'whatif') {
        if (h.value === P.solution[h.cell]) { console.log('FAIL wrong what-if', diff, i); fail++; break; }
        board[h.cell] = P.solution[h.cell];
      }
    }
    if (!check(P, board).solved) { console.log('FAIL hints did not finish', diff, i); fail++; }
    for (const j of P.open) if (P.champ[j] >= 0) st.champ++; else if (P.given[j] >= 0) st.given++;
    st.arrow += P.arrows.length; st.la += P.lookaheads;
  }
  const f = x => (x / N).toFixed(1);
  console.log(`${diff}: givens ${f(st.given)}, champions ${f(st.champ)}, arrows ${f(st.arrow)}, lookaheads ${f(st.la)}` +
    `${DIFFS[diff].needLookahead ? `, too easy ${st.easyHard}/${N}` : ''}, ${f(st.ms)} ms avg, ${st.maxMs} ms max`);
}
console.log(fail ? `${fail} FAILURES` : 'all ok');
process.exit(fail ? 1 : 0);
