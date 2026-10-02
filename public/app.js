import { initialBoard, legalTargets, opposite, pieceLabel, pieceSide, modeLabel } from './xiangqi.js';

// 页面只保存自己的身份和交互状态，棋盘、玩家和胜负一律以服务端快照为准。
const $ = (id) => document.getElementById(id);
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const state = { room: null, lobby: { online: 0, rooms: [] }, filter: 'all', query: '',
  selected: null, targets: [], flipped: false, cursor: { x: 0, y: 9 }, keyboard: false,
  moving: false, session: null, online: false, chatKey: '', historyKey: '', captureSide: 'red', snapshotAt: 0 };
const invitation = new URL(location.href).searchParams.get('room');
let invitationHandled = false;
// 动画只响应新的实时落子；刷新、观战加入和重开不会回放历史乌龙。
let ownGoalTimer = null;
let animatedKingSide = null;
// 出棋提醒横幅的自动收尾计时器；动画总时长与 CSS 保持 3 秒一致。
let turnBannerTimer = null;
const TURN_BANNER_MS = 3000;
// 胜负短句只在对应视角生成：玩家一条自己的结果，观战者两条双方结果。
let verdictTimer = null;
const VERDICT_DURATION = 2400;
const VERDICT_WORDS = {
  win: ['一战封神！', '横扫千军！', '杀穿全场！', '天下无敌！'],
  lose: ['全军覆没！', '一败涂地！', '惨遭碾压！', '当场破防！'],
};

// 某些隐私模式禁用 Storage，降级为当前页面内存，不阻止用户游玩。
const memory = new Map();
function storage(store, key, value) {
  try {
    if (value === undefined) return store.getItem(key);
    if (value === null) store.removeItem(key); else store.setItem(key, value);
  } catch {
    if (value === undefined) return memory.get(key) || null;
    if (value === null) memory.delete(key); else memory.set(key, value);
  }
}
const socket = window.io({ auth: { token: storage(sessionStorage, 'yijing-token') || '' },
  reconnectionDelay: 800, reconnectionDelayMax: 4000 });

// 用户文本写入 HTML 之前必须转义；棋盘文本只来源于固定棋子字典。
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function toast(message, error = false) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = message;
  $('toast-container').append(el);
  setTimeout(() => el.remove(), 3600);
}
function request(event, data = {}) {
  if (!socket.connected) { toast('网络尚未连接，请稍候', true); return Promise.resolve({ ok: false }); }
  return new Promise((resolve) => {
    socket.timeout(6000).emit(event, data, (error, reply) => {
      const result = error ? { ok: false, error: '请求超时，正在同步最新状态' } : reply || { ok: false };
      if (!result.ok) toast(result.error || '操作失败', true);
      if (error) socket.emit('room:sync', {});
      resolve(result);
    });
  });
}
async function busy(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  try { await action(); } finally { button.disabled = false; if (state.room) renderControls(); }
}
function dialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialogs() { document.querySelectorAll('dialog[open]').forEach((el) => el.close()); }
function confirmAction(title, description) {
  const el = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-description').textContent = description;
  el.returnValue = '';
  el.showModal();
  return new Promise((resolve) => el.addEventListener('close', () => resolve(el.returnValue === 'accept'), { once: true }));
}
$('confirm-accept').addEventListener('click', () => $('confirm-dialog').close('accept'));
$('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close('cancel'));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((el) => el.addEventListener('click', (event) => {
  if (event.target !== el) return;
  const rect = el.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) el.close();
}));

// 每次连接重新获取房间完整状态，覆盖丢包或服务器重启后的旧缓存。
socket.on('connect', async () => {
  state.online = true;
  updateConnection();
  await request('room:sync');
  if (!state.room && invitation && /^\d{6}$/.test(invitation) && !invitationHandled) {
    invitationHandled = true;
    $('join-id').value = invitation;
    dialog('join-dialog');
  }
});
socket.on('disconnect', (reason) => {
  state.online = false;
  clearSelection();
  updateConnection();
  if (reason === 'io server disconnect') toast('此身份已在其他连接打开，请刷新页面重新连接', true);
});
socket.on('connect_error', (error) => {
  state.online = false;
  updateConnection();
  $('connection').title = error.message;
});
socket.on('session:replaced', () => { toast('此标签页的身份已在其他连接打开', true); });
socket.on('session:state', (session) => {
  state.session = session;
  storage(sessionStorage, 'yijing-token', session.token);
  socket.auth = { token: session.token };
  $('profile-name').textContent = session.name;
  const saved = storage(localStorage, 'yijing-name');
  if (saved && saved !== session.name) request('profile:update', { name: saved });
  else if (!saved) storage(localStorage, 'yijing-name', session.name);
});
socket.on('lobby:state', (lobby) => { state.lobby = lobby; renderLobby(); });
socket.on('room:state', (room) => {
  // 恢复或成功进入房间后，邀请已消费；退出后的重连不应再次弹出旧邀请。
  invitationHandled = true;
  // 保留上一份快照，用来判断是否真正发生了行棋方切换。
  const before = state.room;
  const fresh = !before || before.id !== room.id || before.role !== room.role;
  const changed = fresh || before.game.ply !== room.game.ply || before.status !== room.status;
  const reset = fresh || room.game.ply < before.game.ply
    || (before.status === 'finished' && room.status !== 'finished');
  const ownGoal = !fresh && room.game.ply > before.game.ply && room.game.lastMove?.ownGoal;
  const justEnded = !fresh && before.status !== 'finished' && room.status === 'finished' && room.game.result?.winner;
  // 开局与每次换手才提醒；加入进行中的对局、重连和重复快照不重播横幅。
  const turnStarted = room.status === 'playing' && !fresh
    && (before.status !== 'playing' || before.game.turn !== room.game.turn);
  state.room = room;
  state.snapshotAt = Date.now();
  if (reset) { stopOwnGoalAnimation(); stopVerdictAnimation(); stopTurnBanner(); }
  if (fresh) {
    closeDialogs();
    state.flipped = room.role === 'black';
    state.captureSide = room.role === 'black' ? 'black' : 'red';
    state.chatKey = '';
    state.historyKey = '';
    state.keyboard = false;
    const url = new URL(location.href);
    url.searchParams.set('room', room.id);
    history.replaceState(null, '', url);
  }
  if (changed) clearSelection(false);
  $('lobby-view').hidden = true;
  $('room-view').hidden = false;
  renderRoom();
  // 终局优先于乌龙大字；重复快照、刷新及结束后加入观战不重播胜负特效。
  if (justEnded) playVerdictAnimation(room);
  else if (ownGoal) playOwnGoalAnimation(room.game.lastMove);
  // 横幅只在真实换手时播放，且不能浮现在已结束或暂停的对局上。
  if (room.status !== 'playing') stopTurnBanner();
  else if (turnStarted) playTurnBanner(room.game.turn);
});
socket.on('room:left', () => {
  stopOwnGoalAnimation();
  stopVerdictAnimation();
  stopTurnBanner();
  state.room = null;
  clearSelection(false);
  $('room-view').hidden = true;
  $('lobby-view').hidden = false;
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  renderLobby();
});
function updateConnection() {
  $('connection').className = `connection ${state.online ? 'online' : 'offline'}`;
  $('connection').querySelector('span').textContent = state.online ? '实时连接' : '正在重连';
  $('offline-banner').hidden = state.online;
  if (state.room) { renderControls(); renderStatus(); }
}

// 大厅筛选在本地进行，列表只包含真实服务端数据。
function renderLobby() {
  $('room-count').textContent = state.lobby.rooms.length;
  $('online-count').textContent = state.lobby.online;
  const rooms = state.lobby.rooms.filter((r) => (state.filter === 'all' || r.status === state.filter)
    && (!state.query || r.name.toLocaleLowerCase().includes(state.query) || r.id.includes(state.query)))
    .sort((a, b) => Number(b.canJoin) - Number(a.canJoin) || b.createdAt - a.createdAt);
  if (!rooms.length) {
    const filtered = state.query || state.filter !== 'all';
    $('room-list').innerHTML = `<div class="empty-state"><span class="empty-seal">弈</span><h3>${filtered ? '暂时没有符合条件的棋室' : '棋盘已备，只等第一位棋友'}</h3><p>${filtered ? '试试其他关键词，或查看全部房间。' : '创建一间棋室，邀请好友，一起下第一局。'}</p><button class="text-button" data-empty-action type="button">${filtered ? '查看全部房间' : '开一间棋室'} ${icon('arrow')}</button></div>`;
    return;
  }
  const playerName = (p) => p ? `<span class="player-name" title="${escapeHtml(p.name)}${p.online ? '' : ' · 离线'}">${escapeHtml(p.name)}</span>` : '<span class="waiting-seat">虚位以待</span>';
  $('room-list').innerHTML = rooms.map((room) => `<article class="room-row">
    <div class="room-detail"><span class="room-symbol">弈</span><div><h3 title="${escapeHtml(room.name)}">${escapeHtml(room.name)}</h3><small>NO. ${room.id} <span class="mode-pill${room.mode === 'chaos' ? ' chaos' : ''}">${modeLabel(room.mode)}</span></small></div></div>
    <div class="room-players"><span class="side-dot"></span>${playerName(room.red)}<span class="vs">VS</span><span class="side-dot black"></span>${playerName(room.black)}</div>
    <span class="status-badge ${room.status}">${room.status === 'waiting' ? '等待开局' : room.status === 'playing' ? '正在对弈' : '本局结束'}</span>
    <span class="spectator-cell">${icon('eye')}${room.spectators}</span>
    <div class="room-row-actions">${room.canJoin ? `<button class="button primary" data-room="${room.id}" data-mode="player" type="button">加入</button>` : ''}<button class="button secondary" data-room="${room.id}" data-mode="spectator" type="button">观战</button></div>
  </article>`).join('');
}
$('room-list').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-empty-action')) {
    if (state.query || state.filter !== 'all') {
      state.query = ''; $('room-search').value = ''; setFilter('all');
    } else openCreate();
  } else if (button.dataset.room) busy(button, () => request('room:join', { id: button.dataset.room, mode: button.dataset.mode }));
});
function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll('[data-filter]').forEach((button) => button.classList.toggle('selected', button.dataset.filter === filter));
  renderLobby();
}
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter)));
$('room-search').addEventListener('input', (event) => { state.query = event.target.value.trim().toLocaleLowerCase(); renderLobby(); });
$('refresh-lobby').addEventListener('click', () => busy($('refresh-lobby'), async () => {
  if ((await request('lobby:refresh')).ok) toast('大厅已更新');
}));
function openCreate() {
  $('create-name').value = `${state.session?.name || '棋友'}的棋室`;
  dialog('create-dialog');
  $('create-name').select();
}
$('hero-create').addEventListener('click', openCreate);
$('list-create').addEventListener('click', openCreate);
$('create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  busy(event.submitter, () => request('room:create', { name: $('create-name').value,
    side: new FormData($('create-form')).get('side'), gameMode: new FormData($('create-form')).get('gameMode') }));
});
$('quick-join').addEventListener('click', () => { $('join-id').value = ''; dialog('join-dialog'); });
$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  busy(event.submitter, () => request('room:join', { id: $('join-id').value.trim(), mode: event.submitter?.value || 'player' }));
});
$('profile-button').addEventListener('click', () => {
  $('nickname-input').value = state.session?.name || '';
  dialog('profile-dialog'); $('nickname-input').select();
});
$('profile-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('nickname-input').value.trim();
  // 先更新本地昵称，避免收到服务端回显时被旧昵称覆盖。
  const old = storage(localStorage, 'yijing-name');
  storage(localStorage, 'yijing-name', name);
  busy(event.submitter, async () => {
    const result = await request('profile:update', { name });
    if (result.ok) { $('profile-dialog').close(); toast('昵称已保存'); }
    else storage(localStorage, 'yijing-name', old);
  });
});
$('help-button').addEventListener('click', () => dialog('help-dialog'));

// 绘制统一尺寸的 SVG 棋盘；翻转只改变坐标显示，不改变服务器坐标。
function boardMarkup(board, interactive = false) {
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(`<path d="M54 ${57 + i * 54}H486"/>`);
  for (let i = 0; i < 9; i++) {
    const x = 54 + i * 54;
    lines.push(i === 0 || i === 8 ? `<path d="M${x} 57V543"/>` : `<path d="M${x} 57V273M${x} 327V543"/>`);
  }
  lines.push('<path d="m216 57 108 108m0-108L216 165m0 270 108 108m0-108L216 543"/>');
  // 炮位和兵卒位的十字刻线，边缘位置只画棋盘内侧。
  for (const [x, y] of [[1,2],[7,2],[0,3],[2,3],[4,3],[6,3],[8,3],[1,7],[7,7],[0,6],[2,6],[4,6],[6,6],[8,6]]) {
    const px = 54 + x * 54, py = 57 + y * 54;
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      if ((x === 0 && dx === -1) || (x === 8 && dx === 1)) continue;
      lines.push(`<path d="M${px + dx * 5} ${py + dy * 12}v${-dy * 7}h${dx * 7}"/>`);
    }
  }
  let html = `<rect x="40" y="43" width="460" height="514" rx="1" class="board-border"/><g class="chess-grid">${lines.join('')}</g><text x="142" y="309" class="river-text">楚河</text><text x="337" y="309" class="river-text">汉界</text>`;
  for (let i = 0; i < 9; i++) {
    const flipped = interactive && state.flipped;
    html += `<text x="${54 + i * 54}" y="29" class="board-coordinate">${flipped ? '九八七六五四三二一'[8-i] : i+1}</text><text x="${54 + i * 54}" y="583" class="board-coordinate">${flipped ? 9-i : '九八七六五四三二一'[i]}</text>`;
  }
  for (let vy = 0; vy < 10; vy++) {
    for (let vx = 0; vx < 9; vx++) {
      const x = interactive && state.flipped ? 8 - vx : vx;
      const y = interactive && state.flipped ? 9 - vy : vy;
      const px = 54 + vx * 54, py = 57 + vy * 54;
      const piece = board[y][x];
      const selected = interactive && state.selected?.x === x && state.selected?.y === y;
      const target = interactive && state.targets.some((p) => p.x === x && p.y === y);
      const last = interactive && [state.room.game.lastMove?.from, state.room.game.lastMove?.to].some((p) => p?.x === x && p?.y === y);
      const cursor = interactive && state.keyboard && state.cursor.x === x && state.cursor.y === y;
      html += `<g${interactive ? ` class="chess-cell" data-x="${x}" data-y="${y}"` : ''} transform="translate(${px} ${py})">`;
      const description = !piece ? '空位' : piece.hidden
        ? `未知棋（${piece.owner === 'red' ? '红' : '黑'}方操作，原路线：${pieceLabel(piece.route)}）`
        : `${piece.side === 'red' ? '红' : '黑'}方${pieceLabel(piece)}`;
      if (interactive) html += `<title>${description} · ${x+1}列${y+1}行</title><rect x="-27" y="-27" width="54" height="54" fill="transparent"/>`;
      if (last) html += '<rect x="-24" y="-24" width="48" height="48" rx="7" class="last-move-mark"/>';
      if (piece) html += `<circle r="23" class="chess-piece${piece.hidden ? ' hidden-piece' : ''}"/><circle r="19.5" class="chess-piece-ring"/><text y="-1" class="chess-text ${piece.hidden ? 'unknown' : piece.side}">${pieceLabel(piece)}</text>`;
      if (selected) html += '<circle r="25" class="selected-piece"/>';
      if (target) html += piece ? '<circle r="25" class="capture-target"/>' : '<circle r="7" class="legal-target"/>';
      if (cursor) html += '<rect x="-26" y="-26" width="52" height="52" rx="6" class="keyboard-cursor"/>';
      html += '</g>';
    }
  }
  return html;
}
$('preview-board').innerHTML = boardMarkup(initialBoard());
function renderBoard() {
  if (!state.room) return;
  $('game-board').innerHTML = boardMarkup(state.room.game.board, true);
  positionKingReaction();
  positionVerdictAnimation();
}
function clearSelection(render = true) { state.selected = null; state.targets = []; if (render) renderBoard(); }
function canAct() {
  const room = state.room;
  return state.online && !state.moving && room?.status === 'playing' && room.role === room.game.turn
    && room.red?.online && room.black?.online;
}
async function selectPoint(point) {
  if (!canAct()) {
    if (state.room?.role === 'spectator') toast('你正在观战，可以欣赏棋局或参与交流');
    else if (state.room?.status !== 'playing') toast('双方准备后即可开局');
    else if (state.room?.game.turn !== state.room?.role) toast('耐心等候，还没轮到你');
    else toast('正在等待网络或对手重连');
    return;
  }
  const piece = state.room.game.board[point.y][point.x];
  if (state.selected?.x === point.x && state.selected?.y === point.y) { clearSelection(); return; }
  if (pieceSide(piece) === state.room.role) {
    state.selected = point;
    state.targets = legalTargets(state.room.game.board, point, state.room.role);
    renderBoard();
    const route = piece.hidden ? `未知棋 · 原路线：${pieceLabel(piece.route)} · ` : '';
    $('board-hint').textContent = route + (state.targets.length ? '点击圆点落子，圈出的棋子可以吃掉' : '当前没有合法落点');
    return;
  }
  if (!state.selected) return;
  if (!state.targets.some((p) => p.x === point.x && p.y === point.y)) { toast('不是合法落点，试试标出的圆点'); return; }
  state.moving = true;
  try {
    const result = await request('game:move', { from: state.selected, to: point, ply: state.room.game.ply });
    if (result.ok) clearSelection();
  } finally { state.moving = false; }
}
$('game-board').addEventListener('click', (event) => {
  const cell = event.target.closest('[data-x]');
  if (!cell) return;
  state.keyboard = false;
  state.cursor = { x: Number(cell.dataset.x), y: Number(cell.dataset.y) };
  selectPoint(state.cursor);
});
$('game-board').addEventListener('keydown', (event) => {
  if (!state.room) return;
  const delta = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] }[event.key];
  if (delta) {
    event.preventDefault(); state.keyboard = true;
    const sign = state.flipped ? -1 : 1;
    state.cursor = { x: Math.max(0, Math.min(8, state.cursor.x + delta[0] * sign)),
      y: Math.max(0, Math.min(9, state.cursor.y + delta[1] * sign)) };
    renderBoard();
  } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPoint(state.cursor); }
  else if (event.key === 'Escape') { clearSelection(); }
});
$('flip-board').addEventListener('click', () => { state.flipped = !state.flipped; renderBoard(); });

// 左右吃子栏只依赖公开棋谱；始终按实际行棋方分类，而不是翻明后移动棋的阵营。
function renderCaptures() {
  const chaos = state.room.mode === 'chaos';
  $('board-stage').classList.toggle('chaos-stage', chaos);
  for (const id of ['won-panel', 'own-goal-panel', 'capture-tools']) $(id).hidden = !chaos;
  if (!chaos) return;
  document.querySelectorAll('[data-capture-side]').forEach((button) => {
    const selected = button.dataset.captureSide === state.captureSide;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const captures = state.room.game.history.filter((move) => move.captured && move.actor === state.captureSide);
  const won = captures.filter((move) => move.captured.side !== state.captureSide);
  const own = captures.filter((move) => move.captured.side === state.captureSide);
  const markup = (moves) => moves.length ? moves.map((move) => `<span class="taken-piece ${move.captured.side}" title="${move.captured.side === 'red' ? '红' : '黑'}方${pieceLabel(move.captured)} · 第${move.ply}步被吃">${pieceLabel(move.captured)}</span>`).join('')
    : '<span class="capture-empty">暂无</span>';
  $('won-count').textContent = won.length;
  $('own-goal-count').textContent = own.length;
  $('won-pieces').innerHTML = markup(won);
  $('own-goal-pieces').innerHTML = markup(own);
}
$('capture-tools').addEventListener('click', (event) => {
  const button = event.target.closest('[data-capture-side]');
  if (!button || !state.room) return;
  state.captureSide = button.dataset.captureSide;
  renderCaptures();
});

// 将表情定位到当前可见将帅的交点，坐标随翻盘及窗口缩放同步换算。
function positionKingReaction() {
  if (!animatedKingSide || !state.room) return;
  const board = state.room.game.board;
  let king = null;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    if (board[y][x]?.type === 'k' && board[y][x]?.side === animatedKingSide) king = { x, y };
  }
  const reaction = $('king-reaction');
  if (!king) { reaction.hidden = true; return; }
  const rect = $('game-board').getBoundingClientRect();
  const wrap = $('game-board').parentElement.getBoundingClientRect();
  const x = state.flipped ? 8 - king.x : king.x;
  const y = state.flipped ? 9 - king.y : king.y;
  reaction.style.left = `${rect.left - wrap.left + (54 + x * 54) / 540 * rect.width}px`;
  reaction.style.top = `${rect.top - wrap.top + (57 + y * 54) / 600 * rect.height}px`;
}
function stopOwnGoalAnimation() {
  clearTimeout(ownGoalTimer);
  ownGoalTimer = null;
  animatedKingSide = null;
  for (const id of ['king-reaction', 'own-goal-announcement']) {
    $(id).hidden = true;
    $(id).classList.remove('active');
  }
}
function playOwnGoalAnimation(move) {
  stopOwnGoalAnimation();
  animatedKingSide = opposite(move.actor);
  const messages = ['糟了！！！', 'OH NOOOOOOOOO！！', '自己人啊！！！', '这下乌龙了！！！'];
  $('own-goal-announcement').textContent = messages[move.ply % messages.length];
  for (const id of ['king-reaction', 'own-goal-announcement']) {
    $(id).hidden = false;
    // 连续乌龙时重新启动 CSS 渐入渐隐，不重复创建计时器或遗留遮罩。
    void $(id).offsetWidth;
    $(id).classList.add('active');
  }
  positionKingReaction();
  ownGoalTimer = setTimeout(stopOwnGoalAnimation, 2800);
}
// 观战提示固定在红黑各自半场，翻盘时交换上下位置，不依赖已被吃掉的将帅。
function positionVerdictAnimation() {
  if (!state.room || $('board-verdicts').hidden) return;
  const rect = $('game-board').getBoundingClientRect();
  const wrap = $('game-board').parentElement.getBoundingClientRect();
  for (const card of $('board-verdicts').children) {
    const homeY = card.dataset.verdictSide === 'red' ? 7.7 : 1.3;
    const y = state.flipped ? 9 - homeY : homeY;
    card.style.left = `${rect.left - wrap.left + rect.width / 2}px`;
    card.style.top = `${rect.top - wrap.top + (57 + y * 54) / 600 * rect.height}px`;
    card.style.fontSize = `${Math.max(24, Math.min(70, rect.width * .115))}px`;
  }
}
// 清理元素和计时器，避免重开、退出或换房后遗留旧结果。
function stopVerdictAnimation() {
  clearTimeout(verdictTimer);
  verdictTimer = null;
  for (const id of ['player-verdict', 'board-verdicts']) {
    $(id).hidden = true;
    $(id).replaceChildren();
  }
}
// 只生成当前角色可见的大字；同一对局使用统一文案索引，观战结果与玩家对应。
function playVerdictAnimation(room) {
  stopOwnGoalAnimation();
  stopVerdictAnimation();
  const spectator = room.role === 'spectator';
  const sides = spectator ? ['red', 'black'] : [room.role];
  const layer = $(spectator ? 'board-verdicts' : 'player-verdict');
  const index = (Number(room.id) + room.game.ply) % VERDICT_WORDS.win.length;
  for (const side of sides) {
    const outcome = room.game.result.winner === side ? 'win' : 'lose';
    const card = document.createElement('div');
    card.className = `verdict-card ${outcome}${spectator ? ' spectator-verdict' : ' player-verdict'}`;
    card.dataset.verdictSide = side;
    const label = document.createElement('span');
    label.className = 'verdict-label';
    label.textContent = `${spectator ? `${side === 'red' ? '红' : '黑'}方 · ` : ''}${outcome === 'win' ? '胜利' : '败北'}`;
    const word = document.createElement('strong');
    word.className = 'verdict-word';
    word.textContent = VERDICT_WORDS[outcome][index];
    card.append(label, word);
    layer.append(card);
  }
  layer.hidden = false;
  positionVerdictAnimation();
  verdictTimer = setTimeout(stopVerdictAnimation, VERDICT_DURATION);
}
// 两类特效随窗口尺寸重新定位；减少动态效果仍由全局 CSS 偏好设置控制。
window.addEventListener('resize', () => { positionKingReaction(); positionVerdictAnimation(); });

// 对局面板按公开角色设置按钮；观战者从界面和服务器两层被限制走棋。
function renderPlayer(side) {
  const room = state.room;
  const player = room[side];
  const playing = room.status === 'playing';
  const active = playing && room.game.turn === side;
  const isMe = room.role === side;
  const label = side === 'red' ? '红方 · 先手' : '黑方 · 后手';
  let tag = player ? (room.ready[side] ? '已准备' : playing ? (active ? '行棋中' : '等候') : '未准备') : '空席';
  if (player && !player.online) tag = '重连中';
  const el = $(`${side}-player`);
  el.classList.toggle('current-turn', active);
  el.innerHTML = `<span class="player-avatar">${side === 'red' ? '帅' : '将'}</span><div class="player-meta"><strong>${player ? escapeHtml(player.name) : '等待棋友入座'}${isMe ? ' <span style="color:#9ca88c;font-size:10px">(你)</span>' : ''}</strong><small>${label}</small></div><span class="player-tag${player && !player.online ? ' offline' : ''}">${tag}</span>`;
}
// 依据服务端快照的剩余毫秒数本地递减；断线暂停时显示冻结的剩余秒数。
function turnSecondsLeft() {
  const room = state.room;
  if (!room || room.status !== 'playing' || !room.turn) return null;
  const elapsed = room.turn.paused ? 0 : Date.now() - state.snapshotAt;
  return Math.max(0, (room.turn.remainingMs - elapsed) / 1000);
}
// 棋盘顶部展示当前 90 秒时钟；30 秒内数字脉动变红、沙漏摇晃。
function renderTurnTimer() {
  const room = state.room;
  const timer = $('turn-timer');
  if (!room || room.status !== 'playing' || !room.turn) {
    timer.hidden = true;
    return;
  }
  const paused = Boolean(room.turn.paused);
  const seconds = turnSecondsLeft();
  const value = Math.max(0, Math.ceil(seconds));
  timer.hidden = false;
  timer.classList.toggle('warning', !paused && value <= 30);
  timer.classList.toggle('paused', paused);
  $('turn-timer-value').textContent = String(value);
  timer.querySelector('small').textContent = paused ? '暂停' : '秒';
}
// 出棋提醒横幅：从右侧滑入、居中停留 2 秒、再向左滑出；滑动期间斜体，带果冻弹性。
function playTurnBanner(side) {
  const banner = $('turn-banner');
  clearTimeout(turnBannerTimer);
  $('turn-banner-text').textContent = `${side === 'red' ? '红' : '黑'}方出棋`;
  banner.hidden = false;
  // 连续两次同方向提醒时先移除类再强制回流，确保 CSS 动画从头重播。
  banner.classList.remove('active');
  void banner.offsetWidth;
  banner.classList.add('active');
  turnBannerTimer = setTimeout(stopTurnBanner, TURN_BANNER_MS);
}
// 清理横幅与计时器，避免退出房间、重开或换手后遗留旧提示。
function stopTurnBanner() {
  clearTimeout(turnBannerTimer);
  turnBannerTimer = null;
  $('turn-banner').hidden = true;
  $('turn-banner').classList.remove('active');
}
// 超时跳回合只计数不判负，这里把双方剩余机会展示在计时器旁边。
function renderTurnSkips() {
  const room = state.room;
  const chip = $('skip-chip');
  if (!room || room.status !== 'playing' || !room.turnSkips) { chip.hidden = true; chip.textContent = ''; return; }
  const max = room.turnMaxSkips || 3;
  const parts = ['red', 'black'].filter((side) => room.turnSkips[side] > 0)
    .map((side) => `${side === 'red' ? '红' : '黑'}方超时 ${room.turnSkips[side]}/${max}`);
  chip.hidden = !parts.length;
  chip.textContent = parts.join(' · ');
  // 再超时一次就判负时转为警示色，给双方最后的提示。
  chip.classList.toggle('warn', ['red', 'black'].some((side) => room.turnSkips[side] >= max - 1 && room.turnSkips[side] > 0));
}
function renderStatus() {
  const room = state.room;
  if (!room) return;
  let status, hint;
  if (!state.online) { status = '连接中断，正在重连'; hint = '恢复连接后自动同步棋局'; }
  else if (room.status === 'finished') {
    status = room.game.result.winner ? `${room.game.result.winner === 'red' ? '红' : '黑'}方获胜 · ${room.game.result.reason}` : `和棋 · ${room.game.result.reason}`;
    hint = room.role === 'spectator' ? '本局结束，可查看走棋记录' : '双方准备后，再来一局';
  } else if (room.status === 'waiting') {
    status = room.red && room.black ? '棋友已到齐，等待双方准备' : '虚位以待，邀请一位棋友入座';
    hint = '双方准备后即可开始 · 红方先行';
  } else if (!room.red?.online || !room.black?.online) {
    const side = room.red?.online ? 'black' : 'red';
    const left = Math.max(0, Math.ceil((room.reconnectSeconds * 1000 - (Date.now() - (room[side]?.offlineAt || Date.now()))) / 1000));
    status = `等待${side === 'red' ? '红' : '黑'}方重连 · ${left} 秒`;
    hint = '对局暂时暂停，超时未恢复将判负';
  } else {
    const checked = room.game.checkedSides || (room.game.check ? [room.game.turn] : []);
    status = `${room.game.turn === 'red' ? '红' : '黑'}方出棋${checked.length ? ` · ${checked.map((side) => side === 'red' ? '红方' : '黑方').join('、')}被将军！` : ''}`;
    hint = room.role === 'spectator' ? '你正在观战 · 棋局实时同步' : room.role === room.game.turn ? '轮到你了，选择棋子落子' : '对手正在思考，稍候片刻';
  }
  $('game-status').textContent = status;
  $('game-status').classList.toggle('red-turn', room.status === 'playing' && room.game.turn === 'red');
  $('game-status').classList.toggle('black-turn', room.status === 'playing' && room.game.turn === 'black');
  if (!state.selected) $('board-hint').textContent = hint;
}
function renderControls() {
  const room = state.room;
  if (!room) return;
  const player = room.role !== 'spectator';
  const playing = room.status === 'playing';
  $('ready-button').hidden = !player || playing;
  $('ready-button').textContent = room.ready[room.role] ? '取消准备' : room.status === 'finished' ? '再来一局 · 准备' : '准备开局';
  $('sit-button').hidden = player || playing || Boolean(room.red && room.black);
  $('draw-button').hidden = !player || !playing;
  $('resign-button').hidden = !player || !playing;
  $('draw-button').textContent = room.drawOffer === opposite(room.role) ? '同意和棋' : room.drawOffer === room.role ? '等待回应' : '申请和棋';
  for (const id of ['ready-button','sit-button','draw-button','resign-button']) $(id).disabled = !state.online;
  if (room.drawOffer === room.role) $('draw-button').disabled = true;
  const result = room.game.result;
  $('game-result').hidden = !result;
  if (result) $('game-result').innerHTML = `<strong>${result.winner ? `${result.winner === 'red' ? '红' : '黑'}方胜` : '和棋'}</strong><span>${escapeHtml(result.reason)}</span>`;
  const incoming = player && playing && room.drawOffer === opposite(room.role);
  $('draw-notice').hidden = !incoming;
  if (incoming) $('draw-notice').innerHTML = `对手希望和棋，是否同意？<br><button class="button primary" data-draw="accept" type="button">同意</button><button class="button secondary" data-draw="decline" type="button">继续对弈</button>`;
}
function renderChat() {
  const chat = state.room.chat;
  const key = `${state.room.id}:${chat.at(-1)?.id || ''}`;
  if (state.chatKey === key) return;
  state.chatKey = key;
  const el = $('chat-messages');
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  el.innerHTML = chat.map((m) => m.system ? `<div class="chat-message system">${escapeHtml(m.text)}</div>`
    : `<div class="chat-message"><div class="chat-author">${m.side ? `<span class="side-dot ${m.side === 'black' ? 'black' : ''}"></span>` : icon('eye')}${escapeHtml(m.name)}<time>${new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div><p>${escapeHtml(m.text)}</p></div>`).join('');
  if (nearBottom || chat.length < 5) el.scrollTop = el.scrollHeight;
}
function renderHistory() {
  const history = state.room.game.history;
  const key = `${state.room.id}:${history.length}:${state.room.status}`;
  if (state.historyKey === key) return;
  state.historyKey = key;
  $('moves-count').textContent = history.length;
  if (!history.length) { $('move-list').innerHTML = '<p class="activity-empty">落下第一枚棋子，棋谱便从此开始。</p>'; return; }
  let html = '';
  for (let i = 0; i < history.length; i += 2) {
    html += `<div class="move-pair"><span>${Math.floor(i/2)+1}.</span><span title="起点 ${history[i].from.x+1},${history[i].from.y+1}">${escapeHtml(history[i].text)}</span><span>${escapeHtml(history[i+1]?.text || '—')}</span></div>`;
  }
  $('move-list').innerHTML = html;
  $('move-list').scrollTop = $('move-list').scrollHeight;
}
function renderRoom() {
  const room = state.room;
  $('room-title').textContent = room.name;
  $('room-id').textContent = room.id;
  $('role-label').textContent = room.role === 'spectator' ? '观战席' : room.role === 'red' ? '执红' : '执黑';
  $('room-mode').textContent = modeLabel(room.mode);
  $('room-mode').className = `mode-pill${room.mode === 'chaos' ? ' chaos' : ''}`;
  $('ply-count').textContent = `第 ${Math.floor(room.game.ply / 2) + 1} 回合`;
  $('spectator-count').textContent = `${room.spectators.length} 人观战`;
  $('spectator-count').title = room.spectators.map((p) => p.name).join('、');
  renderPlayer('red'); renderPlayer('black'); renderCaptures(); renderBoard(); renderStatus(); renderTurnTimer(); renderTurnSkips(); renderControls(); renderChat(); renderHistory();
}
$('ready-button').addEventListener('click', () => busy($('ready-button'), () => request('game:ready')));
$('sit-button').addEventListener('click', () => busy($('sit-button'), () => request('room:sit')));
$('draw-button').addEventListener('click', () => busy($('draw-button'), () => request('game:draw')));
$('draw-notice').addEventListener('click', (event) => {
  const button = event.target.closest('[data-draw]');
  if (button) busy(button, () => request(button.dataset.draw === 'accept' ? 'game:draw' : 'game:decline-draw'));
});
$('resign-button').addEventListener('click', async () => {
  if (await confirmAction('确认认输？', '本局将判对手获胜，结束后可以双方准备再来一局。')) {
    await busy($('resign-button'), () => request('game:resign'));
  }
});
async function leave() {
  if (!state.room) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const playing = state.room.status === 'playing' && state.room.role !== 'spectator';
  if (await confirmAction('返回联机大厅？', playing ? '正在对局时退出将视为认输。意外断线则保留座位 90 秒。' : '退出当前房间后，你可以加入其他棋室。')) await request('room:leave');
}
$('leave-room').addEventListener('click', leave);
$('nav-lobby').addEventListener('click', leave);
function setActivity(tab) {
  const chatting = tab === 'chat';
  $('chat-tab').classList.toggle('selected', chatting);
  $('moves-tab').classList.toggle('selected', !chatting);
  $('chat-area').hidden = !chatting;
  $('moves-area').hidden = chatting;
  if (chatting) $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  else $('move-list').scrollTop = $('move-list').scrollHeight;
}
$('chat-tab').addEventListener('click', () => setActivity('chat'));
$('moves-tab').addEventListener('click', () => setActivity('moves'));
$('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('chat-input');
  if (!input.value.trim()) return;
  busy(event.submitter, async () => {
    const text = input.value;
    if ((await request('chat:send', { text })).ok && input.value === text) input.value = '';
    input.focus();
  });
});
$('share-room').addEventListener('click', () => {
  const url = new URL(location.href);
  url.searchParams.set('room', state.room.id);
  $('share-link').value = url.href;
  dialog('share-dialog'); $('share-link').select();
});
$('copy-share').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('share-link').value);
    toast('邀请链接已复制');
  } catch {
    $('share-link').select();
    toast('请长按或按 Ctrl+C 复制上方链接');
  }
});
// 点击品牌不重新加载页面，避免对局中误离开；断线倒计时每秒更新。
document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); leave(); });
setInterval(() => {
  renderTurnTimer();
  if (state.room?.status === 'playing') renderStatus();
}, 1000);
renderLobby();
