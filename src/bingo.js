// ─── Standard card: column-major, B(1-15) I(16-30) N(31-45) G(46-60) O(61-75), FREE center
export function generateCard() {
  const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
  const card = [];
  for (let col = 0; col < 5; col++) {
    const [min, max] = ranges[col];
    const nums = shuffle(range(min, max)).slice(0, 5);
    for (let row = 0; row < 5; row++) {
      card.push(col === 2 && row === 2 ? 0 : nums[row]);
    }
  }
  return card;
}

// ─── Classic 1-25 card: no FREE, numbers 1-25 randomly placed
export function generateClassicCard() {
  return shuffle(range(1, 25));
}

// ─── Cell helpers (card is column-major: card[col*5+row])
function cell(card, marked, col, row) {
  const val = card[col * 5 + row];
  return val === 0 || marked.includes(val);
}
function rowLine(card, marked, r) { return [0,1,2,3,4].every(c => cell(card, marked, c, r)); }
function colLine(card, marked, c) { return [0,1,2,3,4].every(r => cell(card, marked, c, r)); }
function diagLine(card, marked, d) {
  return [0,1,2,3,4].every(i => cell(card, marked, i, d === 0 ? i : 4 - i));
}
function countLines(card, marked) {
  let n = 0;
  for (let i = 0; i < 5; i++) {
    if (rowLine(card, marked, i)) n++;
    if (colLine(card, marked, i)) n++;
  }
  if (diagLine(card, marked, 0)) n++;
  if (diagLine(card, marked, 1)) n++;
  return n;
}

// ─── Win patterns
export const WIN_PATTERNS = [
  { id: 'single-line',  name: 'Single Line',  emoji: '━', desc: 'Any 1 row, column, or diagonal',
    check: (c, m) => { for (let i=0;i<5;i++) if(rowLine(c,m,i)||colLine(c,m,i)) return true; return diagLine(c,m,0)||diagLine(c,m,1); } },
  { id: 'double-line',  name: 'Double Line',  emoji: '═', desc: 'Any 2 lines',
    check: (c, m) => countLines(c, m) >= 2 },
  { id: 'triple-line',  name: 'Triple Line',  emoji: '≡', desc: 'Any 3 lines',
    check: (c, m) => countLines(c, m) >= 3 },
  { id: 'five-lines',   name: 'Five Lines',   emoji: '5', desc: 'All 5 rows OR all 5 columns',
    check: (c, m) => [0,1,2,3,4].every(r=>rowLine(c,m,r)) || [0,1,2,3,4].every(i=>colLine(c,m,i)) },
  { id: 'four-corners', name: 'Four Corners', emoji: '⬜', desc: 'All 4 corner squares',
    check: (c, m) => cell(c,m,0,0)&&cell(c,m,4,0)&&cell(c,m,0,4)&&cell(c,m,4,4) },
  { id: 'x-pattern',    name: 'X Pattern',    emoji: '✕', desc: 'Both diagonals',
    check: (c, m) => diagLine(c,m,0) && diagLine(c,m,1) },
  { id: 'plus-pattern', name: '+ Pattern',    emoji: '+', desc: 'Middle row + middle column',
    check: (c, m) => rowLine(c,m,2) && colLine(c,m,2) },
  { id: 't-pattern',    name: 'T Pattern',    emoji: 'T', desc: 'Top row + middle column',
    check: (c, m) => rowLine(c,m,0) && colLine(c,m,2) },
  { id: 'l-pattern',    name: 'L Shape',      emoji: 'L', desc: 'Left column + bottom row',
    check: (c, m) => colLine(c,m,0) && rowLine(c,m,4) },
  { id: 'frame',        name: 'Frame',        emoji: '▣', desc: 'All 16 outer border squares',
    check: (c, m) => {
      for (let i=0;i<5;i++) if(!cell(c,m,i,0)||!cell(c,m,i,4)||!cell(c,m,0,i)||!cell(c,m,4,i)) return false;
      return true;
    } },
  { id: 'blackout',     name: 'Blackout',     emoji: '⬛', desc: 'All 25 squares (Full House)',
    check: (c, m) => c.every(v => v === 0 || m.includes(v)) },
];

export function getPattern(id) { return WIN_PATTERNS.find(p => p.id === id) || WIN_PATTERNS[0]; }
export function checkBingo(card, marked, patternId = 'single-line') {
  return getPattern(patternId).check(card, marked);
}

// ─── Number helpers
export function pickNumber(called, max = 75) {
  const remaining = Array.from({ length: max }, (_, i) => i + 1).filter(n => !called.includes(n));
  if (!remaining.length) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
}

// ─── RPS
export const RPS_EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };

export function resolveRPS(choices) {
  // choices: { uid: 'rock'|'paper'|'scissors' }
  const vals = Object.values(choices);
  if (vals.length === 0) return null;
  if (vals.length === 1) return Object.keys(choices); // only one player — they go first
  const hasR = vals.includes('rock'), hasP = vals.includes('paper'), hasS = vals.includes('scissors');
  if (vals.every(v => v === vals[0])) return null; // all same → tie
  if (hasR && hasP && hasS) return null;            // all 3 → tie
  let winning;
  if (hasR && hasS && !hasP) winning = 'rock';
  else if (hasP && hasR && !hasS) winning = 'paper';
  else if (hasS && hasP && !hasR) winning = 'scissors';
  else return null;
  const winners = shuffle(Object.keys(choices).filter(u => choices[u] === winning));
  const losers  = shuffle(Object.keys(choices).filter(u => choices[u] !== winning));
  return [...winners, ...losers];
}

export function randomRPS() { return ['rock','paper','scissors'][Math.floor(Math.random()*3)]; }

// ─── Utils
function range(min, max) { return Array.from({ length: max - min + 1 }, (_, i) => min + i); }
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
