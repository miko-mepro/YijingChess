<div align="center">

# 弈境 · 中国象棋

**免注册、浏览器即开即玩的中国象棋联机小游戏**

纸木色棋盘 · 全中文界面 · 电脑与手机自适应 · 公网 / 局域网联机与实时观战

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2022.9-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-010101?logo=socketdotio&logoColor=white)](https://socket.io/)
[![Express](https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![GitHub stars](https://img.shields.io/github/stars/miko-mepro/YijingChess?logo=github)](https://github.com/miko-mepro/YijingChess/stargazers)

<img width="1920" height="911" alt="弈境 · 中国象棋界面预览" src="https://github.com/user-attachments/assets/d3ddab0f-eadf-417b-b661-c5128437c252" />

</div>

> **服务端权威棋局**：走棋权限、回合、局面版本与棋规全部由服务器校验，客户端只负责界面渲染与合法落点提示，所有落子均需服务端确认。

---

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [乱阵暗棋玩法](#乱阵暗棋玩法)
- [局域网联机](#局域网联机)
- [部署到服务器](#部署到服务器)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [规则与使用边界](#规则与使用边界)
- [开发与检查](#开发与检查)
- [参考与致谢](#参考与致谢)
- [许可](#许可)

## 功能特性

| 能力 | 说明 |
| --- | --- |
| 🌐 **公网 / 局域网联机** | 所有玩家访问同一服务地址即可连接，无需配置客户端服务器地址。 |
| 🏛️ **实时大厅** | 查看全部房间、等待中的房间及正在对弈的房间，支持按房间名或 6 位房间号搜索。 |
| 🎮 **创建与加入** | 创建时选择普通象棋 / 乱阵暗棋及执红 / 执黑，支持房间号与邀请链接，双方准备后开局。 |
| 🎲 **乱阵暗棋** | 将帅固定明牌，其余 30 枚全局随机；首次移动翻明并移交真实阵营，左右展示赢棋 / 乌龙记录。 |
| 👀 **房间观战** | 实时同步棋盘、双方在线状态与走棋记录，旁观者可以交流但不能操作对局。 |
| ♟️ **对局操作** | 合法落点提示、翻转棋盘、键盘操作、认输、申请 / 拒绝和棋、双方准备再来一局。 |
| 💥 **胜负大字特效** | 快速渐入并沉重砸落，胜利红字、败北黑字；观战者在棋盘两方半场分别看到结果。 |
| 🔄 **断线恢复** | 原标签页刷新 / 重连后恢复身份及棋局，玩家座位保留 90 秒。 |
| 🛡️ **服务端权威棋规** | 走棋权限、回合、局面版本和棋规全部由服务器校验，客户端无法篡改局面。 |
| 🚀 **开箱即用部署** | 提供 Node.js、Docker Compose、Nginx 反向代理与 systemd 服务示例。 |

## 快速开始

需要 Node.js **22.9 或更高版本**，推荐 Node.js 24 LTS。

```bash
# 安装锁定依赖，然后启动网页与联机服务。
npm ci
npm start
```

打开 **http://localhost:5500**，终端同时输出本机可用的局域网地址。

开发时使用 `npm run dev` 自动重启服务；重启会清空棋局。

### 怎么玩

1. 点击右上角昵称，设置自己的名字。
2. 创建房间，分享「邀请棋友」链接；对方也可在大厅加入或输入房间号。
3. 双方点击「准备开局」，红方先行。
4. 点击自己的棋子，再点击绿色圆点；绿色虚线圈标记可吃的棋子。
5. 其他玩家在大厅点击「观战」，即可同步旁观并聊天。

棋盘也支持键盘操作：方向键移动选择位置，回车 / 空格选子和落子，Esc 取消选择。

每个标签页通过 `sessionStorage` 保存自己的会话，昵称保存在 `localStorage`。测试双人联机时可使用不同浏览器、无痕窗口，或独立打开的标签页；请勿复制带有现有身份的标签页来占用多个座位。

## 乱阵暗棋玩法

创建房间时选择「乱阵暗棋」，双方准备后开局；普通象棋仍按经典明棋规则游玩。

- **身份随机、数量不变**：将帅固定原位且不隐藏；其余 30 枚跨阵营洗牌到原始棋位，红黑双方各棋名数量保持不变。未知棋统一显示中性「？」。
- **开局一次标记友方**：红方原区域的棋子标记为红方操作，黑方原区域标记为黑方操作；同标记不能互吃，不因移动到其他区域重新标记。
- **首次按原路线走**：点击未知棋可查看该初始棋位的路线，例如原马位先按马走。首次移动或被吃后翻明，按真实阵营一次性更新归属，此后按真实棋名走棋；翻出对手的棋子会立即移交给对手。
- **士象仍守普通限制**：明牌士、相仍受本方九宫和河界限制。随机身份可能导致其揭示在不合法区域、暂时或完全没有合法着法；本模式不是放宽士象范围的标准揭棋。
- **左右吃子记录**：左侧「赢棋」记录行棋方吃掉的真实敌棋，右侧「乌龙」记录误吃的真实友棋；被吃未知棋先翻明，再分类。红黑记录视角可以切换，观战也可查看。
- **乌龙动画**：行棋方对手的将帅位置浮出 `🤣🤣`，屏幕中央黑红大字渐入渐隐。双方和旁观者同步显示，动画不阻挡操作，支持翻盘和缩放，刷新不回放历史动画。
- **意外自将不回退**：合法落点与送将判断只使用移动前的公开信息。首次移动翻明后意外造成自己被将军，保留这步，由对手继续行棋，可吃将获胜；其他将死、困毙、认输和和棋规则沿用普通模式。
- **真正隐藏信息**：未翻明身份仅保存在服务端，玩家、观战者和刷新恢复收到的棋盘与棋谱都不包含真实身份。重开保留模式、重新洗牌并清空吃子记录。

## 局域网联机

在一台电脑运行服务，其他设备连接同一局域网，打开：

```text
http://主机局域网IP:5500
例如：http://192.168.1.10:5500
```

- 默认监听 `0.0.0.0`，支持局域网连接；可用 `ipconfig`（Windows）或 `ip addr`（Linux）查看主机地址。
- 主机防火墙需要放行 TCP 5500。Windows 在可信的专用网络中，可由管理员执行下面的命令。
- 如果同一设备有多个网卡，请选择与其他玩家同网段的地址；不要选择虚拟机或代理网卡地址。
- 分享局域网链接前，先用主机 IP 打开页面，再点击「邀请棋友」。`localhost` 只指向访问者自己的设备。
- 路由器的访客网络、AP 隔离可能阻止设备互访。本项目不自动发现主机，也不提供 P2P 打洞。

```powershell
# 仅放行可信专用网络中的象棋服务，不开放所有端口。
New-NetFirewallRule -DisplayName "弈境象棋" -Direction Inbound -Protocol TCP -LocalPort 5500 -Action Allow -Profile Private
```

## 部署到服务器

### 方式一：Docker Compose

服务器安装 Docker 与 Compose 插件后，在项目目录运行：

```bash
# 构建应用并常驻运行；进程退出或服务器重启后自动恢复服务。
docker compose up -d --build

# 查看运行状态、健康状态和日志。
docker compose ps
docker compose logs -f
```

默认映射服务器 TCP 5500，访问 `http://服务器IP:5500`。云服务器安全组和系统防火墙也要放行对应端口。

可以自行创建项目根目录的 `.env` 文件修改主机端口，例如：

```dotenv
# Docker 主机端口；容器内部端口固定为 5500。
PORT=5500
# 直连需要 0.0.0.0；同机 Nginx 反代可设为 127.0.0.1。
BIND_ADDRESS=0.0.0.0
# 原生 Node.js 启动时的监听地址。
HOST=0.0.0.0
# 默认同源即可连接，通常无需配置额外来源。
ALLOWED_ORIGINS=
```

修改后重新执行 `docker compose up -d`。镜像使用非 root 用户运行，并提供 `/healthz` 健康检查；Compose 限制为只读文件系统。没有数据库或持久化卷，服务重启后房间和棋局清空。

### 方式二：原生 Node.js + systemd

Linux 上可以把源码放到 `/opt/xiangqi`，在该目录执行 `npm ci --omit=dev`，创建专用 `xiangqi` 用户，然后使用 `deploy/xiangqi.service`：

```bash
# 先核对服务文件中的用户、工作目录和 Node.js 绝对路径。
sudo cp deploy/xiangqi.service /etc/systemd/system/xiangqi.service
sudo systemctl daemon-reload
sudo systemctl enable --now xiangqi
sudo journalctl -u xiangqi -f
```

服务文件默认使用 `/usr/bin/node`，请用 `command -v node` 检查实际路径。Node.js 的 `.env` 可选，`npm start` 和服务文件都会读取它；未创建时使用默认值。不要使用 development watch 模式运行长期对局。

### 方式三（公网推荐）：Nginx + HTTPS

1. 将域名解析到服务器。
2. 配置 `deploy/nginx.conf`，替换 `chess.example.com` 为真实域名；它应处于 Nginx 的 `http` 上下文，例如 `/etc/nginx/conf.d/`。
3. 如果使用不同的 Node.js 端口，修改 `proxy_pass`。
4. 执行 `nginx -t` 后重载 Nginx，配置自己的 TLS 证书，让玩家通过 **HTTPS** 访问。
5. 对外放行 80 / 443；同机反代时将应用端口绑定到 `127.0.0.1`，避免直接暴露 Node.js 端口。

配置已经转发 WebSocket 的 `Upgrade` / `Connection` 请求头，支持 Socket.IO 的轮询回退。默认要求连接同源，代理必须保留客户端原始 `Host`。只有确实需要额外来源时，才设置 `ALLOWED_ORIGINS=https://来源一,https://来源二`。

> ⚠️ 不应长期在公网使用 HTTP：昵称和会话令牌都应通过 HTTPS 传输。公网部署由你自己的服务器承载，本项目不附带公共服务器或域名。

## 技术栈

| 层次 | 技术选型 |
| --- | --- |
| 前端 | 原生 HTML / CSS / ES Modules，无构建步骤 |
| 后端 | Node.js ≥ 22.9（推荐 24 LTS）、Express 5、Socket.IO 4.8 |
| 棋规 | `public/xiangqi.js` 由浏览器与服务端共享，实际落子以服务端为准 |
| 存储 | 单实例内存存储，无数据库、无持久化卷 |
| 部署 | Docker Compose、Nginx 反向代理 + WebSocket、systemd |

架构上采用 Express + Socket.IO + 原生 ES Modules，无需前端编译，便于小型服务器和局域网电脑部署。浏览器只计算落点提示，所有实际落子均由服务端验证；客户端不上传棋盘，避免篡改局面。

## 项目结构

```text
public/
  index.html          中文大厅、房间和弹窗
  styles.css          响应式纸木风格界面
  app.js              Socket.IO 客户端与互动棋盘
  xiangqi.js          浏览器 / 服务器共享棋规
  favicon.svg         本地矢量图标
server/
  index.js            会话、大厅、房间、观战与权威棋局
deploy/
  nginx.conf          Nginx 反向代理示例（含 WebSocket 转发）
  xiangqi.service     systemd 服务单元示例
docs/
  设计方案.md         架构、功能及规则边界
Dockerfile            Node.js 24 Alpine 非 root 镜像
compose.yaml          Docker Compose 部署配置
```

## 规则与使用边界

- 普通模式实现马腿、象眼、象不过河、九宫限制、炮隔子吃子、兵卒过河、不能送将和将帅照面；暗棋的公开路线及翻明例外见上方玩法说明。
- 将死获胜；无合法着法但未被将军的困毙也判负。
- 同一局面（含行棋方）出现三次，或连续 120 半回合没有吃子及兵卒移动，自动和棋。
- **休闲规则，不等同于竞赛裁判规则**：没有长将 / 长捉责任判定、计时、悔棋、AI 或积分排名。
- 意外断线时暂停落子，保留座位 90 秒，超时判负；双方同时离线超时判和。对局中主动退出视为认输。
- 服务端 2 秒一次检查超时，实际清理可能延迟最多约 2 秒。离线旁观者同样在超时后释放。
- 房间开放旁观；没有账号体系、密码房间和永久棋谱。会话令牌只发送给本人，不应分享。
- **单实例内存存储**：重启清空会话与房间，不支持直接多副本部署。横向扩容需要共享房间状态、会话存储、Socket.IO 适配器和房间调度，并非简单增加 replicas。
- 限制最多 200 个房间、每房间 100 个旁观身份、2000 个会话；离线且无房间的会话在一小时后清理。
- 每个客户端采用容量 30、每秒补充 10 的操作令牌桶；昵称最多 16 字、房间名最多 32 字、聊天最多 200 字，最近 100 条消息保存在内存中。
- 公网高负载或对抗场景还需要在入口代理配置连接限流、监控及防护；当前版本适合朋友对弈和小规模部署。

## 开发与检查

```bash
# 只检查 JavaScript 语法，不创建测试文件。
npm run check

# 查看当前生产依赖的已知安全问题。
npm audit --omit=dev

# 检查服务是否启动。
curl http://localhost:5500/healthz
```

浏览器联机验证可分别打开三个独立身份：红方、黑方和旁观者，检查准备开局、走棋同步、聊天、刷新恢复、和棋、认输与重开。Docker 构建需要在安装了 Docker 的机器上验证。

## 参考与致谢

规则和 UI 为独立实现，没有复制第三方棋规库代码。架构与规则分层参考以下开源项目与文档：

- [xiangqi.js](https://github.com/lengyanyu258/xiangqi.js/) —— 开源象棋规则接口
- [PyChess 乱阵暗棋（Jieqi）分层](https://www.pychess.org/variants/jieqi) —— 暗棋 / 明棋分层与首次走棋揭示机制
- [Socket.IO 服务端 API](https://socket.io/docs/v4/server-api/) —— 房间与事件机制
- [Socket.IO 断线恢复](https://socket.io/docs/v4/connection-state-recovery) —— 重新同步设计

## 许可

本项目目前未附带开源许可证文件。如需他人复用、修改或分发，请先在仓库根目录添加 `LICENSE` 文件（例如 MIT / Apache-2.0）以明确授权范围。
