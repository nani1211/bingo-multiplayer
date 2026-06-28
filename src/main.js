import {
  GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInAnonymously,
  signOut, onAuthStateChanged, updateProfile
} from 'firebase/auth';
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs,
  updateDoc, onSnapshot, query, where, serverTimestamp, increment
} from 'firebase/firestore';
import { auth, db } from './firebase.js';
import {
  generateCard, generateClassicCard,
  checkBingo, pickNumber,
  WIN_PATTERNS, getPattern,
  resolveRPS, randomRPS, RPS_EMOJI, shuffle
} from './bingo.js';

// ─── Constants ──────────────────────────────────────────────────────
const AUTO_INTERVAL_SEC = 8;
const MANUAL_TURN_SEC   = 15;
const RPS_SEC           = 15;

// ─── State ──────────────────────────────────────────────────────────
let currentUser   = null;
let currentRoomId = null;
let unsubRoom     = null;
let unsubPlayers  = null;
let autoCallTimer = null;
let hostTurnTimer = null;
let countdownTimer = null;
let playersCache      = {};  // uid → name
let myCard            = null;
let myMarked          = [];
let currentRpsChoices = {};  // uid → choice, from room doc
let isCallerPickMode  = false; // classic25: caller clicks board cells to call numbers

// Persisted per-player UI prefs
let highlightOn = localStorage.getItem('bingo_highlight') !== 'false';

// Lobby form state
let selectedMode      = 'auto';
let selectedTurnOrder = 'random';

// ─── Guest names ─────────────────────────────────────────────────────
const GUEST_ADJ  = ['Lucky','Happy','Swift','Bold','Brave','Calm','Wild','Fluffy','Mighty','Sneaky','Sleepy','Bright'];
const GUEST_NOUN = ['Panda','Tiger','Fox','Dolphin','Koala','Penguin','Rabbit',
                    'Mango','Kiwi','Berry','Peach','Lemon',
                    'Waffle','Noodle','Taco','Pizza','Ramen','Sushi',
                    'Tokyo','Paris','Cairo','Sydney','Lima','Vienna'];
function randomGuestName() {
  return GUEST_ADJ[Math.floor(Math.random() * GUEST_ADJ.length)] + ' ' +
         GUEST_NOUN[Math.floor(Math.random() * GUEST_NOUN.length)];
}

function generateRoomCode() {
  // Unambiguous characters (no 0/O, 1/I/L confusion)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─── Lobby: populate win-pattern dropdown ────────────────────────────
const patternSel = qs('#win-pattern-select');
WIN_PATTERNS.forEach(p => {
  const o = document.createElement('option');
  o.value = p.id;
  o.textContent = `${p.emoji} ${p.name} — ${p.desc}`;
  patternSel.appendChild(o);
});

// Mode toggle
qs('#mode-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.toggle');
  if (!btn) return;
  qs('#mode-toggle').querySelectorAll('.toggle').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedMode = btn.dataset.val;
  qs('#turn-order-row').style.display = selectedMode !== 'auto' ? 'flex' : 'none';
  // Classic25 cards don't have B-I-N-G-O columns
  qs('#card-header').style.visibility = selectedMode === 'classic25' ? 'hidden' : 'visible';
});

// Turn-order toggle
qs('#turn-order-toggle').addEventListener('click', e => {
  const btn = e.target.closest('.toggle');
  if (!btn) return;
  qs('#turn-order-toggle').querySelectorAll('.toggle').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedTurnOrder = btn.dataset.val;
});

// ─── Highlight toggle ────────────────────────────────────────────────
qs('#btn-highlight-toggle').onclick = () => {
  highlightOn = !highlightOn;
  localStorage.setItem('bingo_highlight', highlightOn);
  qs('#btn-highlight-toggle').style.opacity = highlightOn ? '1' : '0.35';
  qs('#btn-highlight-toggle').title = highlightOn ? 'Highlight ON' : 'Highlight OFF';
  reHighlightCard(highlightOn ? (myCard ? getCalledFromDOM() : []) : []);
};
qs('#btn-highlight-toggle').style.opacity = highlightOn ? '1' : '0.35';

function getCalledFromDOM() {
  return [...qs('#called-numbers')?.querySelectorAll('.called-num')]
    .map(el => Number(el.textContent));
}

// ─── Auth tabs ───────────────────────────────────────────────────────
qs('#screen-auth').addEventListener('click', e => {
  const tab = e.target.closest('.auth-tab');
  if (!tab) return;
  qs('#screen-auth').querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  qs('#screen-auth').querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  qs(`#auth-panel-${tab.dataset.tab}`).classList.add('active');
});

// ─── Guest join ──────────────────────────────────────────────────────
const guestNameEl     = qs('#guest-name');
const guestRoomCodeEl = qs('#guest-room-code');
const guestErrEl      = qs('#guest-error');

// Pre-fill with a random fun name
guestNameEl.value = randomGuestName();

qs('#btn-random-name').onclick = () => { guestNameEl.value = randomGuestName(); };

async function guestJoin() {
  const name = guestNameEl.value.trim();
  const code = guestRoomCodeEl.value.trim().toUpperCase();
  if (!name) { guestErrEl.textContent = 'Please enter your name'; return; }
  if (code.length < 4) { guestErrEl.textContent = 'Enter the room code from the host'; return; }
  guestErrEl.textContent = '';
  qs('#btn-guest-join').disabled = true;
  try {
    const cred = await signInAnonymously(auth);
    await updateProfile(cred.user, { displayName: name });
    currentUser = auth.currentUser;
    const snap = await getDocs(query(collection(db, 'rooms'), where('roomCode', '==', code)));
    if (snap.empty) throw new Error('Room not found — check the code');
    const roomDoc = snap.docs[0];
    if (roomDoc.data().status !== 'waiting') throw new Error('That room already started');
    await joinRoom(roomDoc.id);
    guestRoomCodeEl.value = '';
  } catch (e) {
    console.error('Guest join error:', e);
    guestErrEl.textContent = e.code === 'auth/operation-not-allowed'
      ? 'Guest join not enabled yet — try Sign In instead'
      : e.message;
    qs('#btn-guest-join').disabled = false;
  }
}
qs('#btn-guest-join').onclick = guestJoin;
guestRoomCodeEl.addEventListener('keydown', e => { if (e.key === 'Enter') guestJoin(); });
guestRoomCodeEl.addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// ─── Auth ────────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  currentUser = user;
  if (!user) {
    showScreen('auth');
    return;
  }
  if (user.isAnonymous) {
    // Guests navigate directly: auth screen → game (never through lobby)
    // On page refresh they return to auth screen (currentRoomId is lost)
    return;
  }
  qs('#user-display-name').textContent = user.displayName || user.email;
  showScreen('lobby');
});

qs('#btn-google-login').onclick = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { authErr(e.message); }
};
qs('#btn-email-login').onclick = async () => {
  try { await signInWithEmailAndPassword(auth, qs('#input-email').value, qs('#input-password').value); }
  catch (e) { authErr(e.message); }
};
qs('#btn-email-signup').onclick = async () => {
  try {
    const c = await createUserWithEmailAndPassword(auth, qs('#input-email').value, qs('#input-password').value);
    await updateProfile(c.user, { displayName: qs('#input-email').value.split('@')[0] });
  } catch (e) { authErr(e.message); }
};
qs('#btn-logout').onclick = () => signOut(auth);
function authErr(m) { qs('#auth-error').textContent = m; }

// ─── Join by room code ───────────────────────────────────────────────
async function joinByCode() {
  const input = qs('#input-room-code');
  const code = input.value.trim().toUpperCase();
  if (code.length < 4) { qs('#code-error').textContent = 'Enter the room code'; return; }
  qs('#code-error').textContent = '';
  qs('#btn-join-code').disabled = true;
  try {
    const snap = await getDocs(query(collection(db, 'rooms'), where('roomCode', '==', code)));
    if (snap.empty) { qs('#code-error').textContent = 'Room not found'; qs('#btn-join-code').disabled = false; return; }
    const roomDoc = snap.docs[0];
    if (roomDoc.data().status !== 'waiting') { qs('#code-error').textContent = 'That room already started'; qs('#btn-join-code').disabled = false; return; }
    await joinRoom(roomDoc.id);
    input.value = '';
  } catch (e) {
    console.error('Join by code error:', e);
    qs('#code-error').textContent = 'Could not join: ' + e.message;
    qs('#btn-join-code').disabled = false;
  }
}
qs('#btn-join-code').onclick = joinByCode;
qs('#input-room-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinByCode(); });
qs('#input-room-code').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

qs('#btn-create-room').onclick = async () => {
  const btn = qs('#btn-create-room');
  btn.disabled = true;
  try {
    const ref = await addDoc(collection(db, 'rooms'), {
      hostId: currentUser.uid,
      hostName: currentUser.displayName || currentUser.email,
      status: 'waiting',
      gameMode: selectedMode,
      winPattern: qs('#win-pattern-select').value,
      turnOrderMode: selectedMode !== 'auto' ? selectedTurnOrder : 'random',
      calledNumbers: [],
      playerCount: 0,
      lastCalledAt: null,
      callerOrder: null,
      currentCallerId: null,
      currentCallerIndex: null,
      callerTurnStartedAt: null,
      rpsRound: 0,
      rpsDeadline: null,
      rpsChoices: null,
      winner: null,
      winnerName: null,
      roomCode: generateRoomCode(),
      createdAt: serverTimestamp()
    });
    await joinRoom(ref.id);
  } catch (e) {
    console.error('Create/join error:', e);
    alert('Failed to create room: ' + e.message);
    btn.disabled = false;
  }
};

async function joinRoom(roomId) {
  currentRoomId = roomId;
  const [roomSnap, playerSnap] = await Promise.all([
    getDoc(doc(db, 'rooms', roomId)),
    getDoc(doc(db, 'rooms', roomId, 'players', currentUser.uid))
  ]);
  if (!roomSnap.exists()) throw new Error('Room not found');
  const room = roomSnap.data();
  if (room.status !== 'waiting') throw new Error('Room already started');

  const isNewPlayer = !playerSnap.exists();
  if (isNewPlayer) {
    const card = room.gameMode === 'classic25' ? generateClassicCard() : generateCard();
    await setDoc(doc(db, 'rooms', roomId, 'players', currentUser.uid), {
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email,
      card,
      markedNumbers: [],
      hasBingo: false
    });
    // Non-blocking count update — race conditions here are cosmetic only
    updateDoc(doc(db, 'rooms', roomId), { playerCount: increment(1) })
      .catch(e => console.warn('playerCount increment failed:', e));
  }

  listenGame(roomId);
  showScreen('game');
}

// ─── Game ────────────────────────────────────────────────────────────
function listenGame(roomId) {
  qs('#game-room-id').textContent = `#${roomId.slice(0,6).toUpperCase()}`;

  if (unsubRoom) unsubRoom();
  unsubRoom = onSnapshot(doc(db, 'rooms', roomId), snap => {
    if (!snap.exists()) return;
    const room = snap.data();
    const isHost   = room.hostId === currentUser.uid;
    const isCaller = room.currentCallerId === currentUser.uid;

    // Room code in header
    if (room.roomCode) qs('#game-room-id').textContent = room.roomCode;

    // Badges + win hint
    const pat = getPattern(room.winPattern);
    qs('#game-badges').innerHTML =
      `<span class="badge badge-${room.gameMode}">${modeName(room.gameMode)}</span>` +
      `<span class="badge badge-pattern">${pat.emoji} ${pat.name}</span>` +
      (room.turnOrderMode === 'rps' ? '<span class="badge badge-rps">🪨 RPS</span>' : '');
    qs('#win-hint').textContent = `Win: ${pat.desc}`;
    qs('#card-header').style.visibility = room.gameMode === 'classic25' ? 'hidden' : 'visible';

    renderCalledNumbers(room.calledNumbers || []);
    if (highlightOn) reHighlightCard(room.calledNumbers || []);

    if      (room.status === 'waiting') onWaiting(room, isHost, roomId);
    else if (room.status === 'rps')     onRPS(room, roomId, isHost);
    else if (room.status === 'playing') onPlaying(room, roomId, isHost, isCaller);
    else if (room.status === 'finished') onFinished(room);
  }, err => console.error('Room listener error:', err));

  if (unsubPlayers) unsubPlayers();
  unsubPlayers = onSnapshot(collection(db, 'rooms', roomId, 'players'), async snap => {
    const players = snap.docs.map(d => d.data());
    players.forEach(p => { playersCache[p.uid] = p.name; });
    renderPlayers(players);

    const meDoc = snap.docs.find(d => d.id === currentUser.uid)?.data();
    if (meDoc) {
      myCard   = meDoc.card;
      myMarked = meDoc.markedNumbers;
      const roomSnap = await getDoc(doc(db, 'rooms', roomId));
      const called = roomSnap.exists() ? (roomSnap.data().calledNumbers || []) : [];
      renderCard(meDoc.card, meDoc.markedNumbers, called, roomId);
    }

    // Update RPS player status list
    renderRPSPlayers(players);
  }, err => console.error('Players listener error:', err));
}

// ─── Status handlers ─────────────────────────────────────────────────
function onWaiting(room, isHost, roomId) {
  isCallerPickMode = false;
  qs('#rps-overlay').style.display = 'none';
  qs('#turn-indicator').textContent = `${room.playerCount || 0} player(s) in room`;
  qs('#timer').textContent = '';
  qs('#game-message').textContent = '';
  clearAllTimers();

  const startBtn = qs('#btn-start-game');
  qs('#btn-call-number').style.display = 'none';
  if (isHost) {
    startBtn.style.display = 'block';
    startBtn.onclick = () => startGame(room, roomId);
  } else {
    startBtn.style.display = 'none';
  }
}

function onRPS(room, roomId, isHost) {
  currentRpsChoices = room.rpsChoices || {};
  qs('#btn-start-game').style.display = 'none';
  qs('#btn-call-number').style.display = 'none';
  qs('#rps-overlay').style.display = 'flex';

  const round = room.rpsRound || 1;
  qs('#rps-round-label').textContent = round > 1 ? `⚡ Tie! Round ${round}` : '';

  // Re-enable buttons each round (tie-redo resets choices)
  const myChoice = currentRpsChoices[currentUser?.uid];
  qs('#rps-overlay').querySelectorAll('.rps-btn').forEach(b => b.disabled = !!myChoice);
  qs('#rps-status').textContent = myChoice ? `You chose ${RPS_EMOJI[myChoice]} ${myChoice}` : '';

  // Countdown to deadline
  clearCountdown();
  countdownTimer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((room.rpsDeadline - Date.now()) / 1000));
    qs('#rps-timer-display').textContent = `${remaining}s`;
    qs('#rps-timer-display').className = remaining <= 3 ? 'urgent' : '';
  }, 500);

  // Bind choice buttons
  ['rock', 'paper', 'scissors'].forEach(c => {
    qs(`#rps-${c}`).onclick = () => submitRPS(roomId, c);
  });
  qs('#rps-random-btn').onclick = () => submitRPS(roomId, randomRPS());

  // Host watches for all-chosen or deadline
  if (isHost) {
    clearInterval(hostTurnTimer);
    hostTurnTimer = setInterval(() => checkRPSEnd(roomId, room), 1000);
  }
}

function onPlaying(room, roomId, isHost, isCaller) {
  qs('#rps-overlay').style.display = 'none';
  qs('#btn-start-game').style.display = 'none';

  if (room.gameMode === 'auto') {
    qs('#btn-call-number').style.display = 'none';
    qs('#turn-indicator').textContent = 'Auto-calling numbers…';
    if (isHost && !autoCallTimer) startAutoCall(roomId);
    startCountdown(room.lastCalledAt, AUTO_INTERVAL_SEC, 'Next in');

  } else {
    const callerName = playersCache[room.currentCallerId] || '…';
    if (isCaller) {
      if (room.gameMode === 'classic25') {
        isCallerPickMode = true;
        qs('#turn-indicator').innerHTML = `<span class="your-turn">Tap your board to call a number!</span>`;
        qs('#btn-call-number').style.display = 'none';
        // Re-render card with callable cells
        if (myCard) renderCard(myCard, myMarked, room.calledNumbers || [], roomId);
      } else {
        isCallerPickMode = false;
        qs('#turn-indicator').innerHTML = `<span class="your-turn">Your turn to call!</span>`;
        qs('#btn-call-number').style.display = 'block';
        qs('#btn-call-number').onclick = () => doManualCall(roomId, room);
      }
      startCountdown(room.callerTurnStartedAt, MANUAL_TURN_SEC, 'Call in');
    } else {
      isCallerPickMode = false;
      qs('#btn-call-number').style.display = 'none';
      qs('#turn-indicator').textContent = `${callerName} is calling…`;
      startCountdown(room.callerTurnStartedAt, MANUAL_TURN_SEC, 'Auto in');
    }
    // Host manages turn-expiry
    if (isHost) {
      clearInterval(hostTurnTimer);
      hostTurnTimer = setInterval(() => checkTurnExpiry(roomId, room), 1000);
    }
  }
}

function onFinished(room) {
  isCallerPickMode = false;
  clearAllTimers();
  qs('#rps-overlay').style.display = 'none';
  qs('#btn-start-game').style.display = 'none';
  qs('#btn-call-number').style.display = 'none';
  qs('#timer').textContent = '';
  qs('#turn-indicator').textContent = '🏁 Game ended';
  qs('#game-message').textContent = room.winner === currentUser.uid
    ? '🎉 BINGO! You win!'
    : room.winner ? `🎊 ${room.winnerName} got BINGO!` : '🏁 No winner — all numbers called';
}

// ─── Start game ──────────────────────────────────────────────────────
async function startGame(room, roomId) {
  if (room.gameMode === 'auto') {
    await updateDoc(doc(db, 'rooms', roomId), { status: 'playing', lastCalledAt: Date.now() });
    return;
  }

  if (room.turnOrderMode === 'rps') {
    await updateDoc(doc(db, 'rooms', roomId), {
      status: 'rps',
      rpsRound: 1,
      rpsDeadline: Date.now() + RPS_SEC * 1000,
      rpsChoices: {}
    });
  } else {
    // Random order
    const playersSnap = await getDocs(collection(db, 'rooms', roomId, 'players'));
    const order = shuffle(playersSnap.docs.map(d => d.id));
    await updateDoc(doc(db, 'rooms', roomId), {
      status: 'playing',
      callerOrder: order,
      currentCallerId: order[0],
      currentCallerIndex: 0,
      callerTurnStartedAt: Date.now(),
      lastCalledAt: Date.now()
    });
  }
}

// ─── RPS ─────────────────────────────────────────────────────────────
async function submitRPS(roomId, choice) {
  qs('#rps-overlay').querySelectorAll('.rps-btn').forEach(b => b.disabled = true);
  qs('#rps-status').textContent = `You chose ${RPS_EMOJI[choice]} ${choice}`;
  try {
    await updateDoc(doc(db, 'rooms', roomId), { [`rpsChoices.${currentUser.uid}`]: choice });
  } catch (e) {
    console.error('RPS submit error:', e);
    qs('#rps-overlay').querySelectorAll('.rps-btn').forEach(b => b.disabled = false);
    qs('#rps-status').textContent = '⚠️ Failed to submit — try again';
  }
}

async function checkRPSEnd(roomId, room) {
  const [playersSnap, roomSnap] = await Promise.all([
    getDocs(collection(db, 'rooms', roomId, 'players')),
    getDoc(doc(db, 'rooms', roomId))
  ]);
  if (!roomSnap.exists() || roomSnap.data().status !== 'rps') {
    clearInterval(hostTurnTimer); hostTurnTimer = null;
    return;
  }
  const fresh = roomSnap.data();
  const rpsChoices = fresh.rpsChoices || {};
  const players = playersSnap.docs.map(d => d.data());
  const allChosen = players.every(p => rpsChoices[p.uid] != null);
  const deadlinePassed = Date.now() >= fresh.rpsDeadline;

  if (!allChosen && !deadlinePassed) return;
  clearInterval(hostTurnTimer); hostTurnTimer = null;

  // Assign random to anyone who didn't choose
  const choices = {};
  players.forEach(p => { choices[p.uid] = rpsChoices[p.uid] || randomRPS(); });

  const order = resolveRPS(choices);

  if (order === null) {
    // Tie → redo: reset choices map in room doc
    await updateDoc(doc(db, 'rooms', roomId), {
      rpsRound: (fresh.rpsRound || 1) + 1,
      rpsDeadline: Date.now() + RPS_SEC * 1000,
      rpsChoices: {}
    });
  } else {
    await updateDoc(doc(db, 'rooms', roomId), {
      status: 'playing',
      callerOrder: order,
      currentCallerId: order[0],
      currentCallerIndex: 0,
      callerTurnStartedAt: Date.now(),
      lastCalledAt: Date.now(),
      rpsChoices: choices,
      rpsDeadline: null
    });
    const winnerName = playersCache[order[0]] || order[0];
    qs('#game-message').textContent = `${RPS_EMOJI[choices[order[0]]]} ${winnerName} goes first!`;
    setTimeout(() => { if (qs('#game-message').textContent.includes('goes first')) qs('#game-message').textContent = ''; }, 3000);
  }
}

function renderRPSPlayers(players) {
  const el = qs('#rps-player-list');
  if (!el) return;
  el.innerHTML = players.map(p =>
    `<div class="rps-player">${p.name} ${currentRpsChoices[p.uid] ? '✅' : '⏳'}</div>`
  ).join('');
}

// ─── Auto-call (host only) ───────────────────────────────────────────
function startAutoCall(roomId) {
  autoCallTimer = setInterval(async () => {
    const snap = await getDoc(doc(db, 'rooms', roomId));
    if (!snap.exists() || snap.data().status !== 'playing') {
      clearInterval(autoCallTimer); autoCallTimer = null; return;
    }
    await callNextNumber(roomId, snap.data());
  }, AUTO_INTERVAL_SEC * 1000);
}

// ─── Turn management (host) ──────────────────────────────────────────
async function checkTurnExpiry(roomId, room) {
  const elapsed = (Date.now() - (room.callerTurnStartedAt || 0)) / 1000;
  if (elapsed < MANUAL_TURN_SEC) return;
  clearInterval(hostTurnTimer); hostTurnTimer = null;
  const snap = await getDoc(doc(db, 'rooms', roomId));
  if (!snap.exists() || snap.data().status !== 'playing') return;
  const fresh = snap.data();
  if ((Date.now() - (fresh.callerTurnStartedAt || 0)) / 1000 >= MANUAL_TURN_SEC) {
    await callNextNumber(roomId, fresh);
  }
}

async function doManualCall(roomId, room) {
  qs('#btn-call-number').disabled = true;
  await callNextNumber(roomId, room);
  qs('#btn-call-number').disabled = false;
}

async function callNextNumber(roomId, room) {
  const called = room.calledNumbers || [];
  const max = room.gameMode === 'classic25' ? 25 : 75;
  const num = pickNumber(called, max);
  if (!num) {
    await updateDoc(doc(db, 'rooms', roomId), { status: 'finished', winnerName: null });
    return;
  }
  const update = { calledNumbers: [...called, num], lastCalledAt: Date.now() };
  if (room.gameMode !== 'auto') {
    const order = room.callerOrder || [];
    const next = order.length ? (room.currentCallerIndex + 1) % order.length : 0;
    update.currentCallerIndex = next;
    update.currentCallerId    = order[next];
    update.callerTurnStartedAt = Date.now();
  }
  await updateDoc(doc(db, 'rooms', roomId), update);
}

async function pickClassicNumber(num) {
  isCallerPickMode = false;
  const snap = await getDoc(doc(db, 'rooms', currentRoomId));
  if (!snap.exists()) return;
  const room = snap.data();
  const called = room.calledNumbers || [];
  if (called.includes(num)) return;
  const order = room.callerOrder || [];
  const next = order.length ? (room.currentCallerIndex + 1) % order.length : 0;
  await updateDoc(doc(db, 'rooms', currentRoomId), {
    calledNumbers: [...called, num],
    lastCalledAt: Date.now(),
    currentCallerIndex: next,
    currentCallerId: order[next] || room.currentCallerId,
    callerTurnStartedAt: Date.now()
  });
}

// ─── Mark number ─────────────────────────────────────────────────────
async function markNumber(num, card, marked, roomId) {
  if (marked.includes(num)) return;
  const snap = await getDoc(doc(db, 'rooms', roomId));
  if (!snap.exists() || snap.data().status !== 'playing') return;
  if (!snap.data().calledNumbers.includes(num)) {
    // Flash the cell red briefly to indicate it's not called yet
    qs(`#bingo-card`)?.querySelectorAll('.cell')
      .forEach(c => { if (Number(c.dataset.val) === num) { c.classList.add('blocked'); setTimeout(() => c.classList.remove('blocked'), 600); } });
    return;
  }
  const newMarked = [...marked, num];
  await updateDoc(doc(db, 'rooms', roomId, 'players', currentUser.uid), { markedNumbers: newMarked });
  if (checkBingo(card, newMarked, snap.data().winPattern)) {
    await updateDoc(doc(db, 'rooms', roomId, 'players', currentUser.uid), { hasBingo: true });
    await updateDoc(doc(db, 'rooms', roomId), {
      winner: currentUser.uid,
      winnerName: currentUser.displayName || currentUser.email,
      status: 'finished'
    });
  }
}

// ─── Countdown timer ─────────────────────────────────────────────────
function startCountdown(startedAt, totalSec, label) {
  clearCountdown();
  countdownTimer = setInterval(() => {
    const remaining = Math.max(0, totalSec - Math.floor((Date.now() - (startedAt || Date.now())) / 1000));
    const el = qs('#timer');
    el.textContent = `${label} ${remaining}s`;
    el.className = remaining <= 3 ? 'urgent' : '';
  }, 500);
}
function clearCountdown() { clearInterval(countdownTimer); countdownTimer = null; }

// ─── Leave room ───────────────────────────────────────────────────────
qs('#btn-leave-room').onclick = () => {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  if (unsubPlayers) { unsubPlayers(); unsubPlayers = null; }
  clearAllTimers();
  currentRoomId = null;
  myCard = null; myMarked = [];
  isCallerPickMode = false;
  playersCache = {};
  qs('#rps-overlay').style.display = 'none';
  if (currentUser?.isAnonymous) {
    showScreen('auth');
  } else {
    showScreen('lobby');
  }
};

function clearAllTimers() {
  clearInterval(autoCallTimer); autoCallTimer = null;
  clearInterval(hostTurnTimer); hostTurnTimer = null;
  clearCountdown();
}

// ─── Render ───────────────────────────────────────────────────────────
function renderCalledNumbers(nums) {
  const latest = nums[nums.length - 1];
  qs('#current-number').textContent = latest ?? '—';
  qs('#called-numbers').innerHTML = [...nums].reverse().map(n =>
    `<div class="called-num${n === latest ? ' latest' : ''}">${n}</div>`
  ).join('');
}

function renderCard(card, marked, calledNumbers, roomId) {
  const el = qs('#bingo-card');
  el.innerHTML = '';
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const val = card[c * 5 + r];
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.val = val;
      if (val === 0) {
        cell.textContent = 'FREE';
        cell.classList.add('free', 'marked');
      } else {
        cell.textContent = val;
        if (marked.includes(val)) {
          cell.classList.add('marked');
        } else if (isCallerPickMode && !calledNumbers.includes(val)) {
          // Caller in classic mode: tap to call this number
          cell.classList.add('callable');
          cell.onclick = () => pickClassicNumber(val);
        } else {
          if (highlightOn && calledNumbers.includes(val)) cell.classList.add('hot');
          cell.onclick = () => markNumber(val, card, marked, roomId);
        }
      }
      el.appendChild(cell);
    }
  }
}

function reHighlightCard(calledNumbers) {
  qs('#bingo-card')?.querySelectorAll('.cell:not(.free)').forEach(cell => {
    const val = Number(cell.dataset.val);
    if (!cell.classList.contains('marked')) {
      if (highlightOn && calledNumbers.includes(val)) cell.classList.add('hot');
      else cell.classList.remove('hot');
    }
  });
}

function renderPlayers(players) {
  qs('#players-list').innerHTML = players.map(p =>
    `<div class="player-chip${p.hasBingo ? ' winner' : ''}${p.uid === currentUser?.uid ? ' me' : ''}">
      ${p.name}${p.hasBingo ? ' 🎉' : ''}
    </div>`
  ).join('');
}

// ─── Utils ────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  qs(`#screen-${name}`).classList.add('active');
  if (name === 'auth') {
    qs('#btn-guest-join').disabled = false;
    qs('#guest-error').textContent = '';
    // Refresh random name for a new session feel
    if (!qs('#guest-name').value) qs('#guest-name').value = randomGuestName();
  }
}
function qs(sel) { return document.querySelector(sel); }
function modeName(m) {
  return m === 'auto' ? '⏱ Auto' : m === 'classic25' ? '🎯 Classic' : '👆 Turn';
}
