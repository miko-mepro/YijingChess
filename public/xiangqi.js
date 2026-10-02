// 浏览器和服务端共享公开信息棋规；随机身份与实际落子的最终决定权只在服务端。
export const SIDES = ['red', 'black'];
export const GAME_MODES = ['classic', 'chaos'];
export const opposite = (side) => side === 'red' ? 'black' : 'red';
export const modeLabel = (mode) => mode === 'chaos' ? '乱阵暗棋' : '普通象棋';
const LABELS = {
  red: { r: '车', n: '马', b: '相', a: '仕', k: '帅', c: '炮', p: '兵' },
  black: { r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒' },
};
// 暗棋的操作标记和原路线是公开信息，不读取其私有真实身份。
export const pieceSide = (piece) => piece?.hidden ? piece.owner : piece?.side;
export const pieceRoute = (piece) => piece?.hidden ? piece.route : piece;
export const pieceLabel = (piece) => piece?.hidden ? '?' : LABELS[piece.side][piece.type];
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

// 将帅不入池；Fisher–Yates 全局洗牌精确保留双方各棋名数量，服务端注入密码学随机索引。
function hiddenBoard(randomIndex) {
  const board = initialBoard();
  const squares = [];
  const identities = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const piece = board[y][x];
    if (piece && piece.type !== 'k') { squares.push({ x, y }); identities.push({ ...piece }); }
  }
  for (let i = identities.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [identities[i], identities[j]] = [identities[j], identities[i]];
  }
  squares.forEach(({ x, y }, i) => {
    const route = board[y][x];
    board[y][x] = { hidden: true, owner: route.side, route: { ...route }, identity: identities[i] };
  });
  return board;
}

// 白名单序列化是隐藏信息的安全边界：不能把内部暗棋对象直接推送给客户端。
export function publicPiece(piece) {
  if (!piece) return null;
  return piece.hidden ? { hidden: true, owner: piece.owner, route: { type: piece.route.type, side: piece.route.side } }
    : { type: piece.type, side: piece.side };
}
function publicMove(move) {
  return move ? { from: move.from, to: move.to, piece: publicPiece(move.piece), captured: publicPiece(move.captured),
    actor: move.actor, revealed: move.revealed, ownGoal: move.ownGoal, selfCheck: move.selfCheck,
    text: move.text, ply: move.ply } : null;
}
export function publicGame(game) {
  return { mode: game.mode, board: game.board.map((row) => row.map(publicPiece)), turn: game.turn,
    ply: game.ply, check: game.check, checkedSides: game.checkedSides, lastMove: publicMove(game.lastMove),
    result: game.result, history: game.history.map(publicMove) };
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
const inPalace = (point, side) => point.x >= 3 && point.x <= 5 && (side === 'red' ? point.y >= 7 : point.y <= 2);
const inHome = (point, side) => side === 'red' ? point.y >= 5 : point.y <= 4;

// 这里只校验公开路线与操作标记；真实阵营不参与暗棋翻明前的友方禁吃判断。
function pseudoLegal(board, from, to) {
  if (!validPoint(from) || !validPoint(to) || (from.x === to.x && from.y === to.y)) return false;
  const original = board[from.y][from.x];
  const target = board[to.y][to.x];
  if (!original || (target && pieceSide(target) === pieceSide(original))) return false;
  const piece = pieceRoute(original);
  const dx = to.x - from.x, dy = to.y - from.y;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const straight = dx === 0 || dy === 0;
  switch (piece.type) {
    case 'r': return straight && blockers(board, from, to) === 0;
    case 'c': return straight && blockers(board, from, to) === (target ? 1 : 0);
    case 'n':
      if (ax === 2 && ay === 1) return !board[from.y][from.x + Math.sign(dx)];
      if (ax === 1 && ay === 2) return !board[from.y + Math.sign(dy)][from.x];
      return false;
    case 'b': return ax === 2 && ay === 2 && inHome(from, piece.side) && inHome(to, piece.side)
      && !board[from.y + dy / 2][from.x + dx / 2];
    case 'a': return ax === 1 && ay === 1 && inPalace(from, piece.side) && inPalace(to, piece.side);
    case 'k':
      if (target?.type === 'k' && dx === 0 && blockers(board, from, to) === 0) return true;
      return ax + ay === 1 && inPalace(from, piece.side) && inPalace(to, piece.side);
    case 'p': {
      const forward = piece.side === 'red' ? -1 : 1;
      const crossed = !inHome(from, piece.side);
      return (dx === 0 && dy === forward) || (crossed && ay === 0 && ax === 1);
    }
    default: return false;
  }
}

// 模拟合法落点不翻明，避免由禁走提示推断私有身份；落子后才进行不可逆的揭示。
function movedBoard(board, from, to) {
  const next = board.map((row) => row.slice());
  next[to.y][to.x] = next[from.y][from.x];
  next[from.y][from.x] = null;
  return next;
}
function revealPiece(piece) {
  if (!piece?.hidden) return piece;
  if (!piece.identity) throw new Error('暗棋身份只能由服务端揭示');
  return { type: piece.identity.type, side: piece.identity.side };
}

// 被吃掉将帅的局面也视为将军；暗棋威胁按照公开操作标记与原路线计算。
export function isInCheck(board, side) {
  let king = null;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    if (board[y][x]?.side === side && board[y][x]?.type === 'k') king = { x, y };
  }
  if (!king) return true;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    if (pieceSide(board[y][x]) === opposite(side) && pseudoLegal(board, { x, y }, king)) return true;
  }
  return false;
}
export function legalMove(board, from, to, side) {
  return validPoint(from) && validPoint(to) && pieceSide(board[from.y][from.x]) === side
    && pseudoLegal(board, from, to) && !isInCheck(movedBoard(board, from, to), side);
}

// 客户端用相同公开信息函数显示落点，服务端仍重新检查每一步。
export function legalTargets(board, from, side) {
  const moves = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    if (legalMove(board, from, { x, y }, side)) moves.push({ x, y });
  }
  return moves;
}
function hasLegalMove(board, side) {
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    if (pieceSide(board[y][x]) !== side) continue;
    for (let ty = 0; ty < 10; ty++) for (let tx = 0; tx < 9; tx++) {
      if (legalMove(board, { x, y }, { x: tx, y: ty }, side)) return true;
    }
  }
  return false;
}

// 重复局面包括暗棋标记、路线与私有身份，计数及键值从不发送给客户端。
function positionKey(board, turn) {
  return `${turn}:${board.flat().map((p) => !p ? '.' : p.hidden
    ? `?${p.owner[0]}${p.route.type}${p.identity.side[0]}${p.identity.type}` : `${p.side[0]}${p.type}`).join('|')}`;
}
export function newGame(mode = 'classic', randomIndex = (max) => Math.floor(Math.random() * max)) {
  mode = GAME_MODES.includes(mode) ? mode : 'classic';
  const board = mode === 'chaos' ? hiddenBoard(randomIndex) : initialBoard();
  return { mode, board, turn: 'red', ply: 0, check: false, checkedSides: [], lastMove: null, result: null,
    quiet: 0, positions: { [positionKey(board, 'red')]: 1 }, history: [] };
}

// 首次行棋用原路线记谱，再追加公开的翻明结果；真实颜色与行棋方分开记载。
function notation(piece, from, to, captured) {
  const digits = piece.side === 'red' ? '九八七六五四三二一' : '123456789';
  const forward = piece.side === 'red' ? to.y < from.y : to.y > from.y;
  const direction = from.y === to.y ? '平' : forward ? '进' : '退';
  const dest = from.y === to.y || ['n', 'b', 'a'].includes(piece.type)
    ? digits[to.x] : piece.side === 'red' ? '零一二三四五六七八九'[Math.abs(to.y - from.y)] : Math.abs(to.y - from.y);
  return `${pieceLabel(piece)}${digits[from.x]}${direction}${dest}${captured ? ` · 吃${pieceLabel(captured)}` : ''}`;
}

// 校验只看移动前公开局面；翻明、移交归属和吃子分类随后执行，意外自将不回退。
export function playMove(game, from, to) {
  if (game.result) throw new Error('这局棋已结束');
  if (!legalMove(game.board, from, to, game.turn)) throw new Error('不能这样走，请留意棋规与将军状态');
  const original = game.board[from.y][from.x];
  const captured = revealPiece(game.board[to.y][to.x]);
  const piece = revealPiece(original);
  const route = pieceRoute(original);
  const board = movedBoard(game.board, from, to);
  board[to.y][to.x] = piece;
  const turn = opposite(game.turn);
  const checkedSides = SIDES.filter((side) => isInCheck(board, side));
  const check = checkedSides.includes(turn);
  const quiet = captured || route.type === 'p' || piece.type === 'p' ? 0 : game.quiet + 1;
  const key = positionKey(board, turn);
  const positions = { ...game.positions, [key]: (game.positions[key] || 0) + 1 };
  const ownGoal = Boolean(captured && captured.side === game.turn);
  const revealed = Boolean(original.hidden);
  const text = `${notation(route, from, to, captured)}${revealed ? ` · 翻明${piece.side === 'red' ? '红' : '黑'}${pieceLabel(piece)}` : ''}${ownGoal ? ' · 乌龙！' : ''}`;
  const lastMove = { from, to, piece, captured, actor: game.turn, revealed, ownGoal,
    selfCheck: revealed && checkedSides.includes(game.turn), text, ply: game.ply + 1 };
  let result = null;
  if (captured?.type === 'k') result = { winner: opposite(captured.side), reason: '将死' };
  else if (!hasLegalMove(board, turn)) result = { winner: game.turn, reason: check ? '将死' : '困毙' };
  else if (positions[key] >= 3) result = { winner: null, reason: '三次重复局面' };
  else if (quiet >= 120) result = { winner: null, reason: '连续 120 半回合无吃子或兵卒移动' };
  return { mode: game.mode, board, turn, ply: game.ply + 1, check, checkedSides, lastMove, result, quiet, positions,
    history: [...game.history, lastMove] };
}
