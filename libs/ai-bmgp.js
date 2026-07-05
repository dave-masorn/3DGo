(function() {
'use strict'

const SGF = 'abcdefghjklmnopqrst';
function sgfCoord(c, r) { return SGF[c] + SGF[r]; }

// ─── 1D sentinel board (same as goban.js / reference site) ───
const EMPTY = 0, BLACK = 1, WHITE = 2, MARKER = 4, OFFBOARD = 7, LIBERTY = 8;
const SZ = 21, SZ2 = SZ * SZ;
const board = new Int32Array(SZ2);
let ko = EMPTY;
let side = BLACK;
let liberties = [];
let block = [];

function initBoard() {
  for (let i = 0; i < SZ2; i++) board[i] = 0;
  for (let i = 0; i < SZ; i++) {
    board[i] = OFFBOARD;
    board[SZ2 - 1 - i] = OFFBOARD;
    board[i * SZ] = OFFBOARD;
    board[i * SZ + SZ - 1] = OFFBOARD;
  }
}

function countLiberties(sq, color) {
  const stone = board[sq];
  if (stone === OFFBOARD) return;
  if (stone && (stone & color) && !(stone & MARKER)) {
    block.push(sq);
    board[sq] |= MARKER;
    for (const offs of [1, SZ, -1, -SZ]) countLiberties(sq + offs, color);
  } else if (stone === EMPTY) {
    board[sq] |= LIBERTY;
    liberties.push(sq);
  }
}

function restoreBoard() {
  block = []; liberties = [];
  for (let sq = 0; sq < SZ2; sq++) {
    if (board[sq] !== OFFBOARD) board[sq] &= 3;
  }
}

function inEye(sq) {
  let eyeColor = -1;
  for (const offs of [1, SZ, -1, -SZ]) {
    if (board[sq + offs] === OFFBOARD) continue;
    if (board[sq + offs] === EMPTY) return 0;
    let c = board[sq + offs];
    if (c > 2) c -= MARKER;
    if (eyeColor === -1) eyeColor = c;
    else if (c !== eyeColor) return 0;
  }
  return eyeColor;
}

function clearBlock(move) {
  if (block.length === 1 && inEye(move) === 3 - side) ko = block[0];
  for (let i = 0; i < block.length; i++) board[block[i]] = EMPTY;
}

function captures(move) {
  for (let sq = 0; sq < SZ2; sq++) {
    const stone = board[sq];
    if (stone === OFFBOARD) continue;
    if (stone & (3 - side)) {
      countLiberties(sq, 3 - side);
      if (liberties.length === 0) clearBlock(move);
      restoreBoard();
    }
  }
}

function setStone(sq, color) {
  if (board[sq] !== EMPTY) return 0;
  if (sq === ko) return 0;
  const oldKo = ko;
  ko = EMPTY;
  board[sq] = color;
  captures(sq);
  countLiberties(sq, color);
  const suicide = liberties.length === 0;
  restoreBoard();
  if (suicide) {
    board[sq] = EMPTY;
    ko = oldKo;
    return 0;
  }
  side = 3 - color;
  return 1;
}

// ─── Ladder detection (exact from goban.js) ───
function isLadder(sq, color) {
  countLiberties(sq, color);
  const libs = JSON.parse(JSON.stringify(liberties));
  restoreBoard();
  if (libs.length === 0) return 1;
  if (libs.length === 1) {
    board[libs[0]] = color;
    if (isLadder(libs[0], color)) { board[libs[0]] = EMPTY; return 1; }
    board[libs[0]] = EMPTY;
  }
  if (libs.length === 2) {
    for (const move of libs) {
      board[move] = 3 - color;
      if (isLadder(sq, color)) { board[move] = EMPTY; return move; }
      board[move] = EMPTY;
    }
  }
  return 0;
}

// ─── Sync app's 2D boardState → 1D board ───
function syncBoard() {
  initBoard();
  const bs = window.boardState || boardState;
  if (!bs) return;
  for (let r = 0; r < bs.length; r++) {
    for (let c = 0; c < bs[r].length; c++) {
      const p = bs[r][c].player;
      if (p === 'B') board[((r + 1) * SZ) + (c + 1)] = BLACK;
      else if (p === 'W') board[((r + 1) * SZ) + (c + 1)] = WHITE;
    }
  }
}

// ─── Build 22-channel input tensor (exact from goban.js inputTensor) ───
const inputBufferLength = 361;
const inputBufferChannels = 22;
const inputGlobalBufferChannels = 19;

// Convert SGF vertex (e.g. "pd") to 1D SQ index
function vertexToSq(vertex) {
  if (!vertex || vertex.length < 2) return -1;
  const col = SGF.indexOf(vertex[0]);
  const row = SGF.indexOf(vertex[1]);
  if (col < 0 || row < 0) return -1;
  return (row + 1) * SZ + (col + 1);
}

function buildInputTensor(aiColor, moves) {
  side = (aiColor === 'B') ? BLACK : WHITE;
  const katago = side;
  const player = 3 - side;
  const binInputs = new Float32Array(inputBufferLength * inputBufferChannels);
  
  for (let y = 0; y < 19; y++) {
    for (let x = 0; x < 19; x++) {
      const sq19 = 19 * y + x;
      const sq21 = 21 * (y + 1) + (x + 1);
      
      binInputs[inputBufferChannels * sq19 + 0] = 1.0;  // bias
      
      if (board[sq21] === katago) binInputs[inputBufferChannels * sq19 + 1] = 1.0;
      if (board[sq21] === player) binInputs[inputBufferChannels * sq19 + 2] = 1.0;
      
      if (board[sq21] === katago || board[sq21] === player) {
        countLiberties(sq21, BLACK);
        const libsBlack = liberties.length;
        restoreBoard();
        countLiberties(sq21, WHITE);
        const libsWhite = liberties.length;
        restoreBoard();
        
        if (libsBlack === 1 || libsWhite === 1) binInputs[inputBufferChannels * sq19 + 3] = 1.0;
        if (libsBlack === 2 || libsWhite === 2) binInputs[inputBufferChannels * sq19 + 4] = 1.0;
        if (libsBlack >= 3 || libsWhite >= 3) binInputs[inputBufferChannels * sq19 + 5] = 1.0;
      }
    }
  }
  
  // Ko
  if (ko !== EMPTY) {
    const col = (ko % 21) - 1;
    const row = Math.floor(ko / 21) - 1;
    if (col >= 0 && row >= 0) {
      const sq19 = row * 19 + col;
      binInputs[inputBufferChannels * sq19 + 6] = 1.0;
    }
  }
  
  // Previous move positions (channels 9-13) from app's moveHistory
  // Use global moveHistory from app.js — contains pass entries with c:-1
  const appHistory = (typeof moveHistory !== 'undefined') ? moveHistory : [];
  const histIdx = appHistory.length - 1;
  // Channel 9: last move (should be opponent's), Channel 10: AI's last move, alternating
  for (let i = 0; i < 5 && (histIdx - i) >= 0; i++) {
    const m = appHistory[histIdx - i];
    if (m && m.c >= 0 && m.r >= 0) {
      binInputs[inputBufferChannels * (19 * m.r + m.c) + (9 + i)] = 1.0;
    } else {
      // Pass — set global input instead (handled in buildGlobalInputs via moves param)
    }
  }
  
  // Ladder features (channels 14-17)
  for (let y = 0; y < 19; y++) {
    for (let x = 0; x < 19; x++) {
      const sq19 = 19 * y + x;
      const sq21 = 21 * (y + 1) + (x + 1);
      const color = board[sq21];
      
      if (color === BLACK || color === WHITE) {
        countLiberties(sq21, BLACK);
        const libsBlack = liberties.length;
        restoreBoard();
        countLiberties(sq21, WHITE);
        const libsWhite = liberties.length;
        restoreBoard();
        
        if (libsBlack === 1 || libsBlack === 2 || libsWhite === 1 || libsWhite === 2) {
          const laddered = isLadder(sq21, color);
          if (laddered === 1) {
            binInputs[inputBufferChannels * sq19 + 14] = 1.0;
            binInputs[inputBufferChannels * sq19 + 15] = 1.0;
            binInputs[inputBufferChannels * sq19 + 16] = 1.0;
          } else if (laddered > 1) {
            const col = laddered % 21;
            const row = Math.floor(laddered / 21);
            const workingMove = 19 * (row - 1) + (col - 1);
            binInputs[inputBufferChannels * workingMove + 17] = 1.0;
          }
        }
      }
    }
  }
  
  restoreBoard();
  return binInputs;
}

function buildGlobalInputs() {
  const globalInputs = new Float32Array(inputGlobalBufferChannels);
  // Pass indicators from app's moveHistory
  const appHistory = (typeof moveHistory !== 'undefined') ? moveHistory : [];
  const histIdx = appHistory.length - 1;
  for (let i = 0; i < 5 && (histIdx - i) >= 0; i++) {
    const m = appHistory[histIdx - i];
    if (m && m.c === -1) globalInputs[i] = 1.0; // this move was a pass
  }
  // Komi: 7.5 for White
  const selfKomi = (side === WHITE) ? 8.5 : -7.5;
  globalInputs[5] = selfKomi / 20.0;
  return globalInputs;
}

// ─── Model loading ───
let danModel = null;
let modelPromise = null;

function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    try {
      if (tf.getBackend() !== 'webgl') {
        await tf.setBackend('webgl');
      }
    } catch(e) {
      try { await tf.setBackend('cpu'); } catch(e2) {}
    }
    try {
      danModel = await tf.loadGraphModel('https://maksimkorzh.github.io/go/model/dan/model.json');
      return danModel;
    } catch(e) {
      console.error('Failed to load AI model:', e);
      return null;
    }
  })();
  return modelPromise;
}

// ─── Find best legal move from policy ───
async function pickMoveFromPolicy(aiColor) {
  const sideColor = (aiColor === 'B') ? BLACK : WHITE;
  const binInputs = buildInputTensor(aiColor);
  const globalInputs = buildGlobalInputs();
  
  const inputTensor = tf.tensor(binInputs, [1, inputBufferLength, inputBufferChannels], 'float32');
  const globalTensor = tf.tensor(globalInputs, [1, inputGlobalBufferChannels], 'float32');
  
  let result;
  try {
    result = await danModel.executeAsync({
      'swa_model/bin_inputs': inputTensor,
      'swa_model/global_inputs': globalTensor,
    });
    
    // Dan model outputs: [ownership, policy, miscvalues, value]
    const policyTensor = result[1];
    const miscValues = result[2];
    
    const policyArr = await policyTensor.slice([0, 0, 0], [1, 1, 361]).array();
    const flatPolicy = policyArr[0][0];
    
    // Get score lead from miscValues[2]
    const miscArr = await miscValues.data();
    const scoreLead = (miscArr[2] * 20).toFixed(1);
    
    // Sort policy indices by probability
    const indices = Array.from({length: 361}, (_, i) => i);
    indices.sort((a, b) => flatPolicy[b] - flatPolicy[a]);
    
    // Try top moves, find first legal one
    for (let i = 0; i < Math.min(indices.length, 50); i++) {
      const best19 = indices[i];
      const row19 = Math.floor(best19 / 19);
      const col19 = best19 % 19;
      const bestMove = 21 * (row19 + 1) + (col19 + 1);
      
      const savedBoard = new Int32Array(board);
      const savedKo = ko;
      const savedSide = side;
      
      if (setStone(bestMove, sideColor)) {
        return { c: col19, r: row19, scoreLead };
      }
      
      // Restore board
      for (let j = 0; j < SZ2; j++) board[j] = savedBoard[j];
      ko = savedKo;
      side = savedSide;
    }
    
    return null; // No legal move found
  } finally {
    inputTensor.dispose();
    globalTensor.dispose();
    if (result) result.forEach(t => t.dispose());
  }
}

// ─── Public API ───
window.AI = {
  sgfCoord,

  async aiGenmove(level, _moves, color) {
    if (!danModel) await loadModel();
    if (!danModel) return { error: 'AI model not loaded' };
    
    syncBoard();
    ko = EMPTY;
    
    const move = await pickMoveFromPolicy(color);
    if (!move) return { error: 'No legal moves' };
    
    return { move: sgfCoord(move.c, move.r) };
  },

};

// Start loading model immediately (async — won't block)
loadModel();
})();
