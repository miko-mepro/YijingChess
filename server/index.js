import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { newGame, opposite, playMove, SIDES } from '../public/xiangqi.js';

// 所有房间由单实例权威维护；服务重启会清空会话和棋局。
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_ROOMS = 200;
const MAX_SESSIONS = 2000;
const MAX_SPECTATORS = 100;
const RECONNECT_MS = 90_000;
const sessions = new Map();
const rooms = new Map();
const app = express();
const httpServer = createServer(app);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);

// 默认只接受页面同源的连接；反向代理应保留原始 Host。
const io = new Server(httpServer, {
  maxHttpBufferSize: 16_384,
  // 额外允许的来源同时放行轮询 CORS；默认空列表保持页面同源访问。
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  allowRequest: (req, done) => {
    const origin = req.headers.origin;
    if (!origin) return done(null, true);
    try {
      done(null, new URL(origin).host === req.headers.host || allowedOrigins.includes(origin));
    } catch { done(null, false); }
  },
});
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: 0 }));

// 身份令牌只发送给本人；重连时恢复同一会话，拒绝超量新会话。
io.use((socket, next) => {
  const supplied = socket.handshake.auth?.token;
  let session = typeof supplied === 'string' && supplied.length <= 100 ? sessions.get(supplied) : null;
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) return next(new Error('服务器繁忙，请稍后再试'));
    const token = randomBytes(32).toString('base64url');
    session = { token, name: `棋友${randomInt(1000, 10000)}`, socketId: null, roomId: null,
      lastSeen: Date.now(), offlineAt: null };
    sessions.set(token, session);
  }
  socket.data.session = session;
  next();
});

// 对不可信字段限定类型、字符长度，并剔除控制字符。
function cleanText(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, max).join('') || fallback;
}
function requiredRoom(session) {
  const room = rooms.get(session.roomId);
  if (!room) throw new Error('你还没有加入房间');
  return room;
}
const sideOf = (room, session) => SIDES.find((side) => room.seats[side] === session.token) || null;
const connected = (session) => Boolean(session?.socketId && io.sockets.sockets.has(session.socketId));
const playerInfo = (token) => {
  const session = sessions.get(token);
  return session ? { name: session.name, online: connected(session), offlineAt: session.offlineAt } : null;
};

// 大厅只有公开摘要，不暴露身份令牌和棋局内部重复计数。
function lobbyData() {
  return {
    online: io.sockets.sockets.size,
    rooms: [...rooms.values()].map((room) => ({
      id: room.id, name: room.name, status: room.status, createdAt: room.createdAt,
      red: playerInfo(room.seats.red), black: playerInfo(room.seats.black),
      spectators: [...room.spectators].filter((token) => connected(sessions.get(token))).length,
      canJoin: room.status !== 'playing' && (!room.seats.red || !room.seats.black),
    })),
  };
}
function broadcastLobby() { io.emit('lobby:state', lobbyData()); }
function snapshot(room, session) {
  const game = room.game;
  return {
    id: room.id, name: room.name, status: room.status,
    role: sideOf(room, session) || 'spectator',
    red: playerInfo(room.seats.red), black: playerInfo(room.seats.black), ready: room.ready,
    spectators: [...room.spectators].map((token) => playerInfo(token)).filter((p) => p?.online),
    game: { board: game.board, turn: game.turn, ply: game.ply, check: game.check,
      lastMove: game.lastMove, result: game.result, history: game.history },
    drawOffer: room.drawOffer, chat: room.chat,
    reconnectSeconds: RECONNECT_MS / 1000,
  };
}
function broadcastRoom(room) {
  room.updatedAt = Date.now();
  for (const token of [...SIDES.map((side) => room.seats[side]), ...room.spectators]) {
    const session = sessions.get(token);
    if (connected(session)) io.to(session.socketId).emit('room:state', snapshot(room, session));
  }
}
function announce(room, text) {
  room.chat.push({ id: randomBytes(6).toString('hex'), name: '系统', text, system: true, time: Date.now() });
  if (room.chat.length > 100) room.chat.shift();
}
function finish(room, winner, reason) {
  room.game.result = { winner, reason };
  room.status = 'finished';
  room.ready = { red: false, black: false };
  room.drawOffer = null;
  announce(room, `${winner ? `${winner === 'red' ? '红' : '黑'}方胜` : '和棋'} · ${reason}`);
}

// 主动离开与意外断线分开处理：主动离开正在进行的棋局即认输。
function leaveRoom(session, notice = true) {
  const room = rooms.get(session.roomId);
  if (!room) { session.roomId = null; return; }
  const side = sideOf(room, session);
  if (side) {
    if (room.status === 'playing') finish(room, opposite(side), '对方离开房间');
    room.seats[side] = null;
    room.ready[side] = false;
  } else room.spectators.delete(session.token);
  announce(room, `${session.name}离开了房间`);
  session.roomId = null;
  if (notice && connected(session)) io.to(session.socketId).emit('room:left');
  broadcastRoom(room);
  if (!room.seats.red && !room.seats.black && !room.spectators.size) rooms.delete(room.id);
  broadcastLobby();
}
function allocateRoomId() {
  let id;
  do { id = String(randomInt(100000, 1000000)); } while (rooms.has(id));
  return id;
}
function assertPlayer(room, session) {
  const side = sideOf(room, session);
  if (!side) throw new Error('观战者不能操作对局');
  return side;
}
function assertNoRoom(session) {
  if (session.roomId) throw new Error('请先退出当前房间');
}

io.on('connection', (socket) => {
  const session = socket.data.session;
  const previous = io.sockets.sockets.get(session.socketId);
  session.socketId = socket.id;
  session.offlineAt = null;
  session.lastSeen = Date.now();
  if (previous && previous.id !== socket.id) {
    previous.emit('session:replaced');
    previous.disconnect(true);
  }
  socket.emit('session:state', { token: session.token, name: session.name });
  const restored = rooms.get(session.roomId);
  if (restored) {
    announce(restored, `${session.name}已连接`);
    broadcastRoom(restored);
  } else session.roomId = null;
  broadcastLobby();

  // 统一处理频率限制、过期连接、异常及请求确认，不相信客户端声明的角色。
  let budget = 30, lastRefill = Date.now();
  function handle(event, action) {
    socket.on(event, (input, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      try {
        if (session.socketId !== socket.id) throw new Error('当前会话已在其他连接打开');
        const now = Date.now();
        budget = Math.min(30, budget + (now - lastRefill) / 1000 * 10);
        lastRefill = now;
        if (budget < 1) throw new Error('操作太快，请稍等');
        budget--;
        session.lastSeen = now;
        const data = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
        const result = action(data) || {};
        ack({ ok: true, ...result });
      } catch (error) {
        ack({ ok: false, error: error instanceof Error ? error.message : '操作失败' });
      }
    });
  }

  handle('profile:update', (data) => {
    const name = cleanText(data.name, 16);
    if (!name) throw new Error('请输入昵称');
    session.name = name;
    socket.emit('session:state', { token: session.token, name });
    const room = rooms.get(session.roomId);
    if (room) broadcastRoom(room);
    broadcastLobby();
  });
  handle('lobby:refresh', () => { socket.emit('lobby:state', lobbyData()); });
  handle('room:sync', () => {
    const room = rooms.get(session.roomId);
    if (room) socket.emit('room:state', snapshot(room, session));
    else socket.emit('room:left');
  });
  handle('room:create', (data) => {
    assertNoRoom(session);
    if (rooms.size >= MAX_ROOMS) throw new Error('房间已满，请加入现有房间');
    const side = data.side === 'black' ? 'black' : 'red';
    const room = { id: allocateRoomId(), name: cleanText(data.name, 32, `${session.name}的棋室`),
      status: 'waiting', seats: { red: null, black: null }, ready: { red: false, black: false },
      spectators: new Set(), game: newGame(), drawOffer: null, chat: [],
      createdAt: Date.now(), updatedAt: Date.now() };
    room.seats[side] = session.token;
    rooms.set(room.id, room);
    session.roomId = room.id;
    announce(room, `${session.name}创建了房间，等待棋友入座`);
    broadcastRoom(room);
    broadcastLobby();
    return { roomId: room.id };
  });
  handle('room:join', (data) => {
    assertNoRoom(session);
    const room = rooms.get(typeof data.id === 'string' ? data.id : '');
    if (!room) throw new Error('房间不存在或已关闭');
    if (data.mode === 'spectator') {
      if (room.spectators.size >= MAX_SPECTATORS) throw new Error('观战人数已满');
      room.spectators.add(session.token);
    } else {
      if (room.status === 'playing') throw new Error('该房间暂时只能观战');
      const side = SIDES.find((s) => !room.seats[s]);
      if (!side) throw new Error('座位已满，你可以选择观战');
      room.seats[side] = session.token;
    }
    session.roomId = room.id;
    announce(room, `${session.name}${data.mode === 'spectator' ? '进入观战' : '入座了'}`);
    broadcastRoom(room);
    broadcastLobby();
  });
  handle('room:sit', () => {
    const room = requiredRoom(session);
    if (sideOf(room, session)) throw new Error('你已经是对局玩家');
    if (room.status === 'playing') throw new Error('请等待本局结束');
    const side = SIDES.find((s) => !room.seats[s]);
    if (!side) throw new Error('两位玩家都已入座');
    room.spectators.delete(session.token);
    room.seats[side] = session.token;
    announce(room, `${session.name}入座了`);
    broadcastRoom(room);
    broadcastLobby();
  });
  handle('room:leave', () => { leaveRoom(session); });
  handle('game:ready', () => {
    const room = requiredRoom(session);
    const side = assertPlayer(room, session);
    if (room.status === 'playing') throw new Error('对局已经开始');
    // 结束后先保留胜负界面，等双方准备好才重置棋盘开始下一局。
    room.ready[side] = !room.ready[side];
    if (SIDES.every((s) => room.seats[s] && room.ready[s] && connected(sessions.get(room.seats[s])))) {
      room.game = newGame();
      room.status = 'playing';
      room.ready = { red: false, black: false };
      room.drawOffer = null;
      announce(room, '双方已准备，对局开始 · 红方先行');
    }
    broadcastRoom(room);
    broadcastLobby();
  });
  handle('game:move', (data) => {
    const room = requiredRoom(session);
    const side = assertPlayer(room, session);
    if (room.status !== 'playing') throw new Error('当前不是对局阶段');
    if (room.game.turn !== side) throw new Error('还没有轮到你');
    if (!SIDES.every((s) => connected(sessions.get(room.seats[s])))) throw new Error('对手正在重连，请稍候');
    if (data.ply !== room.game.ply) throw new Error('棋局已更新，请重新选择落点');
    room.game = playMove(room.game,
      { x: data.from?.x, y: data.from?.y }, { x: data.to?.x, y: data.to?.y });
    room.drawOffer = null;
    if (room.game.result) finish(room, room.game.result.winner, room.game.result.reason);
    broadcastRoom(room);
    if (room.status === 'finished') broadcastLobby();
  });
  handle('game:resign', () => {
    const room = requiredRoom(session);
    const side = assertPlayer(room, session);
    if (room.status !== 'playing') throw new Error('没有正在进行的对局');
    finish(room, opposite(side), '对方认输');
    broadcastRoom(room);
    broadcastLobby();
  });
  handle('game:draw', () => {
    const room = requiredRoom(session);
    const side = assertPlayer(room, session);
    if (room.status !== 'playing') throw new Error('没有正在进行的对局');
    if (room.drawOffer === opposite(side)) finish(room, null, '双方同意和棋');
    else if (!room.drawOffer) {
      room.drawOffer = side;
      announce(room, `${side === 'red' ? '红' : '黑'}方申请和棋`);
    } else throw new Error('已发送和棋申请，等待对方回应');
    broadcastRoom(room);
    broadcastLobby();
  });
  handle('game:decline-draw', () => {
    const room = requiredRoom(session);
    const side = assertPlayer(room, session);
    if (room.drawOffer !== opposite(side)) throw new Error('没有待处理的和棋申请');
    room.drawOffer = null;
    announce(room, '和棋申请已被拒绝');
    broadcastRoom(room);
  });
  handle('chat:send', (data) => {
    const room = requiredRoom(session);
    const text = cleanText(data.text, 200);
    if (!text) throw new Error('消息不能为空');
    room.chat.push({ id: randomBytes(6).toString('hex'), name: session.name, text,
      side: sideOf(room, session), system: false, time: Date.now() });
    if (room.chat.length > 100) room.chat.shift();
    broadcastRoom(room);
  });
  socket.on('disconnect', () => {
    if (session.socketId !== socket.id) return;
    session.socketId = null;
    session.offlineAt = Date.now();
    session.lastSeen = Date.now();
    const room = rooms.get(session.roomId);
    if (room) {
      const side = sideOf(room, session);
      if (side) room.ready[side] = false;
      announce(room, `${session.name}暂时离线${side ? '，座位保留 90 秒' : ''}`);
      broadcastRoom(room);
    }
    broadcastLobby();
  });
});

// 定期释放离线座位；双方均超时离线判和，防止无主棋局永久占用资源。
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const expired = SIDES.filter((side) => {
      const session = sessions.get(room.seats[side]);
      return session && !connected(session) && session.offlineAt && now - session.offlineAt >= RECONNECT_MS;
    });
    if (room.status === 'playing' && expired.length) {
      finish(room, expired.length === 2 ? null : opposite(expired[0]),
        expired.length === 2 ? '双方离线超时' : '对方离线超时');
    }
    for (const side of expired) {
      const session = sessions.get(room.seats[side]);
      room.seats[side] = null;
      room.ready[side] = false;
      if (session) session.roomId = null;
    }
    let changed = expired.length > 0;
    for (const token of room.spectators) {
      const session = sessions.get(token);
      if (!session || (!connected(session) && now - session.offlineAt >= RECONNECT_MS)) {
        room.spectators.delete(token);
        if (session) session.roomId = null;
        changed = true;
      }
    }
    if (!room.seats.red && !room.seats.black && !room.spectators.size) { rooms.delete(room.id); changed = true; }
    if (changed) { broadcastRoom(room); broadcastLobby(); }
    // 结束且缺少玩家的房间仍可看棋谱；全部退出才会关闭。
  }
  for (const [token, session] of sessions) {
    if (!connected(session) && !session.roomId && now - session.lastSeen > 3_600_000) sessions.delete(token);
  }
}, 2000);
cleanup.unref();

httpServer.listen(PORT, HOST, () => {
  console.log(`\n弈境象棋已启动：http://localhost:${PORT}`);
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const info of interfaces || []) {
      if (info.family === 'IPv4' && !info.internal) console.log(`局域网地址：http://${info.address}:${PORT}`);
    }
  }
  console.log('房间与棋局保存在内存中，重启服务后清空。\n');
});
// 容器关闭时停止接收请求并关闭长连接，避免挂住退出流程。
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { clearInterval(cleanup); io.close(() => process.exit(0)); });
}
