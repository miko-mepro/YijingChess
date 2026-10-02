// 浏览器和服务端共享纯函数棋规；实际走棋的最终决定权始终在服务端。
export const SIDES = ['red', 'black'];
export const opposite = (side) => side === 'red' ? 'black' : 'red';
const LABELS = {
  red: { r: '车', n: '马', b: '相', a: '仕', k: '帅', c: '炮', p: '兵' },
  black: { r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒' },
};
export const pieceLabel = (piece) => LABELS[piece.side][piece.type];
export const validPoint = (p) => Boolean(p && Number.isInteger(p.x) && Number.isInteger(p.y)
  && p.x >= 0 && p.x < 9 && p.y >= 0 && p.y < 10);

// 每局创建独立棋子，避免多房间或局面模拟共享可变对象。
export function initialBoard() {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const back = ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'];
  for (const side of SIDES) {
    const home = side === 'red' ? 9 : 0;
    back.forEach((type, x) => { board[home][x] = { type, side }; });
    for (const x of [1, 7]) board[side === 'red' ? 7 : 2][x] = { type: 'c', side };
    for (const x of [0, 2, 4, 6, 8]) board[side === 'red' ? 6 : 3][x] = { type: 'p', side };
  }
  return board;
}

// 统计同一行/列之间的棋子，供车、炮及将帅照面使用。
function blockers(board, from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let count = 0;
  for (let x = from.x + dx, y = from.y + dy; x !== to.x || y !== to.y; x += dx, y += dy) {
    if (board[y][x]) count++;
  }
  return count;
}

// 这里只校验棋子的几何走法；送将和将帅照面由 isInCheck 二次校验。
function pseudoLegal(board, from, to) {
  if (!validPoint(from) || !validPoint(to) || (from.x === to.x && from.y === to.y)) return false;
  const piece = board[from.y][from.x];
  const target = board[to.y][to.x];
  if (!piece || target?.side === piece.side) return false;
  const dx = to.x - from.x, dy = to.y - from.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const straight = dx === 0 || dy === 0;
  const palace = to.x >= 3 && to.x <= 5 && (piece.side === 'red' ? to.y >= 7 : to.y <= 2);
  switch (piece.type) {
    case 'r': return straight && blockers(board, from, to) === 0;
    case 'c': return straight && blockers(board, from, to) === (target ? 1 : 0);
    case 'n':
      if (ax === 2 && ay === 1) return !board[from.y][from.x + Math.sign(dx)];
      if (ax === 1 && ay === 2) return !board[from.y + Math.sign(dy)][from.x];
      return false;
    case 'b': return ax === 2 && ay === 2 && (piece.side === 'red' ? to.y >= 5 : to.y <= 4)
      && !board[from.y + dy / 2][from.x + dx / 2];
    case 'a': return ax === 1 && ay === 1 && palace;
    case 'k':
      if (target?.type === 'k' && dx === 0 && blockers(board, from, to) === 0) return true;
      return ax + ay === 1 && palace;
    case 'p': {
      const forward = piece.side === 'red' ? -1 : 1;
      const crossed = piece.side === 'red' ? from.y <= 4 : from.y >= 5;
      return (dx === 0 && dy === forward) || (crossed && ay === 0 && ax === 1);
    }
    default: return false;
  }
}

// 模拟棋局使用浅拷贝行数组，棋子对象只读，不修改原棋盘。
function movedBoard(board, from, to) {
  const next = board.map((row) => row.slice());
  next[to.y][to.x] = next[from.y][from.x];
  next[from.y][from.x] = null;
  return next;
}

// 被吃掉将帅的局面也视为将军，不能让无将的一方继续走棋。
export function isInCheck(board, side) {
  let king = null;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      if (board[y][x]?.side === side && board[y][x]?.type === 'k') king = { x, y };
    }
  }
  if (!king) return true;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      if (board[y][x]?.side === opposite(side) && pseudoLegal(board, { x, y }, king)) return true;
    }
  }
  return false;
}

export function legalMove(board, from, to, side) {
  return validPoint(from) && validPoint(to) && board[from.y][from.x]?.side === side
    && pseudoLegal(board, from, to) && !isInCheck(movedBoard(board, from, to), side);
}

// 客户端用相同函数显示合法落点，服务端仍重新检查每一步。
export function legalTargets(board, from, side) {
  const moves = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      if (legalMove(board, from, { x, y }, side)) moves.push({ x, y });
    }
  }
  return moves;
}

function hasLegalMove(board, side) {
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      if (board[y][x]?.side === side && legalTargets(board, { x, y }, side).length) return true;
    }
  }
  return false;
}

// 棋盘和行棋方共同构成重复局面标识，不将步数纳入标识。
function positionKey(board, turn) {
  return `${turn}:${board.flat().map((p) => p ? `${p.side[0]}${p.type}` : '.').join('')}`;
}

export function newGame() {
  const board = initialBoard();
  return { board, turn: 'red', ply: 0, check: false, lastMove: null, result: null,
    quiet: 0, positions: { [positionKey(board, 'red')]: 1 }, history: [] };
}

// 简明中文记谱；同列同类棋子用起点坐标补充，避免休闲棋谱歧义。
function notation(piece, from, to, captured) {
  const digits = piece.side === 'red' ? '九八七六五四三二一' : '123456789';
  const forward = piece.side === 'red' ? to.y < from.y : to.y > from.y;
  const direction = from.y === to.y ? '平' : forward ? '进' : '退';
  const dest = from.y === to.y || ['n', 'b', 'a'].includes(piece.type)
    ? digits[to.x] : piece.side === 'red' ? '零一二三四五六七八九'[Math.abs(to.y - from.y)] : Math.abs(to.y - from.y);
  return `${pieceLabel(piece)}${digits[from.x]}${direction}${dest}${captured ? ` · 吃${pieceLabel(captured)}` : ''}`;
}

// 返回新状态，非法走棋抛出中文错误，供服务端直接反馈给客户端。
export function playMove(game, from, to) {
  if (game.result) throw new Error('这局棋已结束');
  if (!legalMove(game.board, from, to, game.turn)) throw new Error('不能这样走，请留意棋规与将军状态');
  const piece = game.board[from.y][from.x];
  const captured = game.board[to.y][to.x];
  const board = movedBoard(game.board, from, to);
  const turn = opposite(game.turn);
  const check = isInCheck(board, turn);
  const quiet = captured || piece.type === 'p' ? 0 : game.quiet + 1;
  const key = positionKey(board, turn);
  const positions = { ...game.positions, [key]: (game.positions[key] || 0) + 1 };
  const lastMove = { from, to, piece, captured, text: notation(piece, from, to, captured), ply: game.ply + 1 };
  let result = null;
  if (!hasLegalMove(board, turn)) result = { winner: game.turn, reason: check ? '将死' : '困毙' };
  else if (positions[key] >= 3) result = { winner: null, reason: '三次重复局面' };
  else if (quiet >= 120) result = { winner: null, reason: '连续 120 步无吃子或兵卒移动' };
  return { board, turn, ply: game.ply + 1, check, lastMove, result, quiet, positions,
    history: [...game.history, lastMove] };
}
