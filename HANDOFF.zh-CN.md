# OpenFrontFroggy 项目交接记录

本文记录 OpenFrontFroggy 从上游 OpenFront fork 后已经完成的改造、当前运行方式、服务器状态和维护注意事项，供后续接手者使用。

文档整理日期：2026-10-12。

## 1. 仓库与版本关系

- 修改版仓库：`https://github.com/Schurfroggy/OpenFrontFroggy.git`
- 本地主分支：`main`
- 上游仓库：`https://github.com/openfrontio/OpenFrontIO.git`
- `origin` 指向修改版仓库，`upstream` 保留为上游只读来源。
- 本次修改开始时的上游基线：`e02eeba66b4801ebae0b686e1b0e4bc03fbf3654`
- 第一批朋友服改造提交：`59ca34c87cdd4b7588ec2b848a4e06194e64d0cd`
- 第二批结算、音乐和管理员测试功能提交：`16755d88e87504f821f6f778289d9c239b70ff01`
- 整理本文前，`main` 与 GitHub 的 `origin/main` 均位于 `16755d88e`。

这是非官方社区修改版，不是 OpenFront 官方发行版。代码继续遵循 AGPL-3.0；资源授权和限制见 `LICENSE-ASSETS` 与 `LICENSING.md`。页脚及加载界面保留 OpenFront 和贡献者的版权声明。

## 2. 项目定位

本 fork 的目标是把依赖 OpenFront 公共服务的项目改造成适合少量朋友使用的自托管版本：

- 保留单人游戏、私人多人房间和游戏核心玩法；
- 不依赖官方公共房间、匹配、商店、排行榜、公会或官方账号；
- 由房主控制房间和队伍；
- 用本地账号、SQLite 成就与简单管理流程支持朋友长期游玩；
- 同时保留普通开发模式，只有 `SELF_HOSTED=true` 时启用朋友服逻辑。

## 3. 已完成的界面与本地化改造

### 3.1 英语和简体中文

- 将界面语言明确收敛为英语与简体中文，并保留语言切换入口。
- 补齐了大量原来缺失的简体中文文本。
- 将不自然的“缺省”统一改为“默认”。
- 新增的账号、成就、队伍分配、高级设置、管理员、结算与音乐相关界面均提供中英文文本。

主要资源：

- `resources/lang/en.json`
- `resources/lang/zh-CN.json`
- `src/client/LangSelector.ts`

### 3.2 首页推荐地图

- 恢复并改造了原本用于公共房间展示的地图卡片，使自托管首页不再空白。
- 每批随机展示 5 张地图卡片，可左右翻页，每 30 秒更新一批。
- 删除卡片里的“单击选择游玩方式”提示。
- 点击推荐卡片后可选择单人游戏或创建多人房间。
- 从推荐卡片进入设置时，推荐的地图和模式会被锁定；难度、队伍数量、国家数量、禁用单位等仍可按规则调整。
- 首页推荐卡片会显示当前登录账号在该地图各难度的通关成就图标。

主要实现：

- `src/client/GameModeSelector.ts`
- `src/client/components/PlayPage.ts`
- `src/client/components/LobbyCard.ts`
- `src/client/components/map/MapDisplay.ts`
- `src/client/SinglePlayerModal.ts`
- `src/client/HostLobbyModal.ts`

### 3.3 官方服务内容精简

在自托管模式下隐藏或停止使用以下官方服务内容：

- 官方登录及官方账号资料；
- 公共房间、自动匹配和排位入口；
- 商店、库存、订阅、奖励和购买流程；
- 排行榜、公会、官方动态及相关轮询；
- 广告、营销弹窗、遥测和第三方游戏平台 SDK；
- 官方对局归档上传及官方单人心跳；
- 游戏卡片右上角“登录以解锁成就”的官方提示；
- 结算页原有 Steam 推广链接。

页脚旁新增了开源属性、原作者团队及支持原项目的说明。

### 3.4 国名汉化（beta）

- 入口：主页面右下角、语言旗帜按钮**左侧**的「国名汉化 beta」。仅在界面语言为中文
  （`zh` 开头）时渲染；切到其他语言按钮消失，翻译也一并失效。
- 覆盖范围：`World`、`Europe`、`Asia`、`North America` 四张图，共 169 个地名，数据在
  `resources/lang/nations/zh-CN.json`（原字符串 → 中文）。未收录的名字回退显示原名。
- 为什么不放进 `resources/lang/*.json`：地名是地图数据不是 UI 文案；全量 4000+ 条会
  让每个语言文件膨胀数倍，而且其中有 10 个名字本身带点号（`St. Gallen`、`L.A.X.`），
  会被语言文件的扁平化逻辑拆成错误的嵌套键。
- 只影响显示：`PlayerInfo.name` 保持原样，回放哈希与 desync 检测不受影响；
  `PlayerView.displayName()` / `name()` 只对国家（Nation）和部落（Bot）查表，真人玩家
  的名字永不翻译。
- 同名不同地：Europe 的国家 Georgia 与 North America 的美国佐治亚都叫 `Georgia`，
  用 `<名称>|<旗帜>` 作为覆盖键区分（`Georgia|Georgia_US → 佐治亚`）。
- 开关保存在 `localStorage.nationNamesZh`，默认关闭。

主要实现：

- `src/client/NationNames.ts`
- `resources/lang/nations/zh-CN.json`
- `src/client/view/PlayerView.ts`（`localizePlaceName`）
- `src/client/LangSelector.ts`（开关按钮）

测试：

```bash
npx vitest tests/client/NationNames.test.ts --run
npx vitest tests/client/LangSelectorNationNames.test.ts --run
```

## 4. 自托管多人游戏

### 4.1 启动方式

本地朋友服使用：

```bash
npm run self-host
```

默认入口为 `http://localhost:9000`。同一局域网中的其他设备可通过 `http://主机局域网IP:9000` 访问。Vite 将浏览器请求和 WebSocket 转发给本机协调服务及游戏 Worker。

内部端口：

- `9000`：浏览器入口；
- `3000`：协调服务；
- `3001`、`3002`：两个游戏 Worker。

详细说明见 `docs/SelfHosting.zh-CN.md`。

### 4.2 房间同步与身份传递

- 修复了同一浏览器使用不同玩家名测试时渲染器对象为空的问题。
- 修复了房主选择的地图/模式在客机加入后被客机默认配置覆盖的问题。
- 房间配置以房主和服务器状态为准，避免客机把“五大湖团队模式”等房间改成“世界混战”。
- 修复了队伍拖动、自动均衡、人类共同一队、允许客机自由选队、踢人及开始游戏等操作没有实际生效的问题。
- 踢出玩家是当前房间行为，不是按名字永久封禁。
- 加入、重连和关闭流程增加了自托管场景所需的处理与校验。

相关实现集中在：

- `src/client/HostLobbyModal.ts`
- `src/client/JoinLobbyModal.ts`
- `src/client/components/LobbyPlayerView.ts`
- `src/core/game/TeamAssignment.ts`
- `src/server/GameServer.ts`
- `src/server/IntentAuthorization.ts`

### 4.3 房主队伍控制

团队房间中已经加入以下控制：

- “允许客机自由选择队伍”开关，默认关闭；
- “自动均衡”一次性分配操作；
- “人类共同一队”一次性分配操作：在队伍容量允许时尽量集中真人，超出容量的真人进入其他队伍；
- 房主可以拖动任意玩家到目标队伍，也可以通过玩家菜单分配；
- 开启自由选队后，客机只能移动自己，不能控制其他玩家；
- 操作结果通过服务器广播给整个房间。

这里的“人类共同一队”不是“所有真人对抗所有 AI 国家”的特殊游戏模式，而只是团队容量约束下的队伍分配策略。

## 5. 游戏设置与成就约束

- 地图、模式、难度等基础设置继续保留。
- 国家数量、部落数量、瞬间建造、水核弹、开局黄金及类似高影响选项被收进“高级设置”。
- 启用高级设置时，界面明确提示本局不能获得成就。
- MIRV 默认关闭。
- 从首页推荐卡片进入时，地图和游戏模式锁定，避免推荐内容与实际开局不一致。

主要实现：

- `src/client/components/GameConfigSettings.ts`
- `src/client/HostLobbyModal.ts`
- `src/client/SinglePlayerModal.ts`
- `src/core/configuration/Config.ts`

## 6. 本地账号系统

### 6.1 基本设计

- 默认身份为游客；游客可以游玩，但不会读取或获得永久成就。
- 顶部导航新增“我的”。首页名字只显示，不再直接编辑。
- “我的”页面支持注册、登录、注销、查看个人资料、修改名字和修改密码。
- 用户名和密码构成账号，不再把浏览器 UUID 或单纯玩家名当作持久身份。
- 用户名按规范化结果判重；密码仅保存加盐后的不可逆哈希，不保存明文。
- 登录会话通过 `HttpOnly`、`SameSite=Lax` Cookie 维持，默认有效期 30 天。
- 账号角色分为 `player` 和 `admin`。

主要实现：

- `src/client/SelfHostedAccount.ts`
- `src/client/SelfHostedAccountModal.ts`
- `src/client/UsernameInput.ts`
- `src/server/SelfHostedAccountStore.ts`
- `src/server/Master.ts`

### 6.2 管理员与忘记密码

- 第一个注册账号可成为管理员，也可用 `SELF_HOSTED_ADMIN_USERS` 预设管理员用户名。
- 当前朋友服将 `Froggy` 配置为管理员。
- 管理员登录后顶部出现“管理”导航。
- 管理页面可查看账号列表、角色、有效会话数量及待处理密码重置申请。
- 普通用户点击“忘记密码”后会提交申请；申请和状态存入 SQLite。
- 管理员批准后，用户可在一小时内设置新密码；申请默认 24 小时过期。
- 管理员不能通过网页给自己提交重置申请，避免自批。
- 管理员忘记密码时由服务器所有者执行：

```bash
npm run account:reset -- Froggy
```

命令只在终端显示一次临时密码，并注销该账号的旧会话。任何文档和仓库中都不应记录用户密码、临时密码或私钥内容。

### 6.3 好友与对局邀请

- 入口：顶部导航“我的”左侧新增“好友”，仅自建版出现。按钮始终可见；
  未登录点击只提示“请先登录”，不会跳转（页面本身也保留同样的提示）。
- 加好友方式（方案 A）：按用户名精确搜索 → 发送请求 → 对方在“请求”标签同意。
  服务器上用户名唯一，所以不需要再造好友码。
- 好友列表不区分在线/离线：邀请落库保存，好友稍后上线仍能看到。
- 局内邀请：大厅右上角在邀请码旁边并排一个“好友”按钮，列出全部好友逐个邀请，
  也可“全部邀请”；邀请码入口原样保留，用于对方未注册或不在好友列表的情况。
- 收到邀请：顶部横幅“X 邀请你加入一场对局”，可“进入对局”或“忽略”；
  同时“好友”导航出现未读角标，好友页“邀请”标签也能进入。
- “进入对局”复用分享链接的既有链路（`Main.openInvite` → `/game/<id>`），
  因此对局中收到邀请会先弹退出确认，接受后整页跳转，行为与点开链接完全一致。
- 送达机制：登录状态下每 10 秒轮询 `/api/self-hosted/inbox`，页面隐藏时暂停，
  内容变化时才派发事件（导航角标、横幅、好友页共用同一个轮询器）。
- 邀请有效期 30 分钟；同一局对同一人重复邀请是幂等的（刷新有效期，不产生重复）。
- 限流：好友请求 20 次/小时，对局邀请 30 次/10 分钟，好友上限 200。

数据与安全：

- 新增 4 张表：`self_hosted_friends`、`self_hosted_friend_requests`、
  `self_hosted_game_invites`，全部 `CREATE TABLE IF NOT EXISTS`，老库直接升级。
- 表内以 `account.id` 关联，但**接口只返回用户名**：`account.id` 同时是
  play-token（`/api/self-hosted/account/play-token`），一旦外泄等于身份被盗用。
- 数据库连接与账号库共用（`SelfHostedAccountStore.db`），只有 master 进程写这几张表。
- 邀请请求只携带对局 ID，不含任何令牌。

主要实现：

- `src/server/SelfHostedFriendsStore.ts`
- `src/server/Master.ts`（`/api/self-hosted/friends*`、`/invites`、`/inbox`）
- `src/client/SelfHostedFriends.ts`
- `src/client/FriendsPolling.ts`
- `src/client/FriendsModal.ts`
- `src/client/components/FriendInviteButton.ts`
- `src/client/components/FriendInviteBanner.ts`

测试：

```bash
npx vitest tests/server/SelfHostedFriendsStore.test.ts --run
npx vitest tests/client/FriendsModal.test.ts --run
```

## 7. 本地成就系统

- 成就绑定登录账号，而不是浏览器 UUID。
- 当前成就键按“账号 ID + 地图 + 难度”记录，不区分单人和多人模式。
- 单人胜利或团队多人胜利均可为参与并获胜的登录玩家记录地图难度成就。
- 同一张地图会显示已经完成的简单、中等、困难和地狱难度标记。
- 成就显示在地图选择卡片和首页随机推荐卡片上。
- 游客不读写成就。
- 启用高级设置的对局不授予成就。

默认数据库：

```text
data/self-hosted.sqlite
```

可通过 `SELF_HOSTED_DB_PATH` 改为持久化路径。数据库还可能有 `-wal` 和 `-shm` 文件；热备份时必须一起保存，或先停止服务再复制主文件。

主要实现：

- `src/core/SelfHostedAchievements.ts`
- `src/client/SelfHostedAchievements.ts`
- `src/server/SelfHostedAchievementStore.ts`

## 8. 音乐与音量系统

旧的 `gameplay.mp3` 和 `menu-theme.mp3` 已删除，替换为：

- 大厅：`MainTitle.mp3`；
- 对局前 15 分钟：随机打乱后的 `Playing1.mp3` 至 `Playing5.mp3`；
- 对局达到 15 分钟后：下一首开始改用随机的 `Fire1.mp3` 至 `Fire3.mp3`；
- 胜利：`Winning.mp3`；
- 失败：播放失败音效，并停止仍在播放的对局 BGM。

音乐规则：

- 每首完整播放结束后留 10 秒空档；
- 新曲使用约 2 秒渐强；
- 大厅曲循环也遵循 10 秒空档；
- 背景音乐使用 HTML5 流式音频，避免一次解码整首大文件；
- 默认主音量为 100%，其余分类音量有各自默认值；
- 浏览器自动播放策略要求用户先点击页面或按键，首次大厅音乐才会开始。

主要实现：

- `src/client/sound/MenuMusic.ts`
- `src/client/sound/SoundManager.ts`
- `src/client/sound/MusicFade.ts`
- `src/client/sound/AudioMixer.ts`
- `proprietary/sounds/music/`

重要部署注意：服务器必须运行 `npm run build-prod`，开发构建不会把专有音乐复制到最终带哈希静态目录。曾经使用 `build-dev` 导致服务器完全没有音乐文件；该问题已通过生产构建修复。

## 9. 胜利与失败结算

原结算页和 Steam 推广区域已经改造成图标化统计面板。

失败结算显示：

1. 最终名次；
2. 存活时间；
3. 击败该玩家的真人、团队或 AI 势力。

文案统一使用“AI 势力”，不使用不适合州级地图的“AI 国家”。

胜利结算显示：

1. 对局时长；
2. 最终领土及地图占比；
3. 团队模式下的团队最终领土及占比；
4. 个人最大领土；
5. 个人最大兵力；
6. 发出的总进攻兵力；
7. 团队模式下的团队进攻兵力；
8. 个人征服的 AI 势力数量及团队合计；
9. 个人各类建筑建设数量，军舰不计入建筑；
10. 单独的军舰数量；
11. 个人经济来源横向条形图。

按需求，团队历史最大领土和团队历史最大兵力不显示。为支持结算，核心统计模型补充了进攻兵力、建筑、军舰、经济来源、淘汰者等本局数据。

主要实现：

- `src/client/hud/layers/WinModal.ts`
- `src/core/game/Stats.ts`
- `src/core/game/StatsImpl.ts`
- `src/core/StatsSchemas.ts`
- `src/client/view/PlayerView.ts`

## 10. 管理员对局测试按钮

- 管理员进入游戏后，右侧工具栏可见“一键胜利”和“一键失败”。
- 普通玩家看不到这两个按钮，也无权发送对应执行请求。
- 操作通过新的确定性执行类型进入游戏更新流，用于快速检查结算、音乐与成就流程。

主要实现：

- `src/client/hud/layers/GameRightSidebar.ts`
- `src/core/execution/AdminSetOutcomeExecution.ts`
- `src/server/IntentAuthorization.ts`

## 11. 当前云服务器部署

当前部署主机：

```text
ubuntu@124.222.245.42
```

连接私钥保存在本机：

```text
~/.ssh/openfront_server.pem
```

不要将私钥内容、服务器密码或账号密码提交到仓库。

服务器布局：

- 代码目录：`/opt/openfrontfroggy`
- 该目录是文件副本，不是 Git 工作区；云端不能直接依赖 `git pull`。
- systemd 服务：`openfrontfroggy.service`
- Nginx 位于前端，代理协调服务和两个 Worker。
- 正式入口：`https://schurfroggy.art/`；`https://www.schurfroggy.art/` 也指向同一服务。两个域名的 A 记录均为 `124.222.245.42`，DNS 由 DNSPod 托管。
- `openfront.schurfroggy.top` 是旧域名，不作为当前访问入口。不要根据该旧域名的 Cloudflare 解析排查正式站点。
- 正式域名的 Nginx 配置：`/etc/nginx/sites-available/openfrontfroggy-art`，通过 `sites-enabled` 启用，复用 `/etc/nginx/snippets/openfrontfroggy-proxy.conf`；HTTP 自动跳转 HTTPS。
- HTTPS 证书覆盖 `schurfroggy.art` 和 `www.schurfroggy.art`，路径为 `/etc/letsencrypt/live/schurfroggy.art/fullchain.pem`，由 Certbot Nginx 插件签发，`certbot.timer` 自动续期。
- 网站备案号：`粤ICP备2026169329号-1`，公共页脚链接到 `https://beian.miit.gov.cn/`。

服务环境的关键项：

```text
SELF_HOSTED=true
SELF_HOSTED_ADMIN_USERS=Froggy
NUM_WORKERS=2
INSTANCE_LETTER=a
SELF_HOSTED_DB_PATH=/var/lib/openfrontfroggy/self-hosted.sqlite
```

数据库持久化：

- 活跃数据库：`/var/lib/openfrontfroggy/self-hosted.sqlite`
- systemd 覆盖文件：`/etc/systemd/system/openfrontfroggy.service.d/persistence.conf`
- 迁移前备份：`/home/ubuntu/openfrontfroggy-backups/20261010-pre-16755d88e/`
- 原项目目录下仍可能保留旧的 `data/self-hosted.sqlite*`，但服务应使用 `/var/lib/openfrontfroggy` 中的数据库。

最后一次核验时，数据库中存在 `Froggy` 管理员账号及其成就数据；后续部署绝不能用本地 `data/` 覆盖服务器持久化数据库。

## 12. 推荐的云端更新流程

以本地仓库为唯一代码源，将代码同步到 `/opt/openfrontfroggy` 时至少排除：

```text
.git/
node_modules/
data/
.env
run-self-host.sh
```

随后在服务器执行：

```bash
cd /opt/openfrontfroggy
npm ci --ignore-scripts
SELF_HOSTED=true npm run build-prod
sudo systemctl restart openfrontfroggy.service
curl http://127.0.0.1/api/health
```

更新后还应确认：

```bash
systemctl is-active openfrontfroggy.service
find static/_assets/sounds/music -type f
```

不要在服务器部署时使用 `npm run build-dev`。生产构建会生成 `asset-manifest.json` 和带内容哈希的 `static/_assets/` 文件，从而保证音乐存在，并让浏览器安全地长期缓存静态资源。

### 发布版本标识与安全切换

- 前端构建使用 `SELF_HOSTED=true npm run build-prod`；构建应在独立候选目录完成，通过后再停止服务、备份数据库并切换目录，缩短停机时间。
- 线上服务使用 `npm run start:server`，由 systemd 环境保留朋友服所需配置，并将 `GIT_COMMIT` 设置为已发布的完整 Git 提交号。不要继续使用会强制写入 `GIT_COMMIT=DEV` 的 `start:server-dev`。
- 保留 `/etc/systemd/system/openfrontfroggy.service.d/persistence.conf` 和 `/var/lib/openfrontfroggy`。发布不能上传本地 `.env` 或 `data/`；数据库备份及旧发布版本仅保存在服务器上。
- 发布后核对 `/desktop/version.json` 的 `clientVersion` 等于提交号，`coreVersion` 等于候选构建的 `static/core-version.txt`；再检查健康接口、首页、Worker 和音乐资源。
- 回退时恢复旧代码与静态资源、旧 systemd 启动配置。反馈功能的数据库升级只新增表，不需要为了代码回退覆盖已经产生的新账号或对局数据。

## 13. 性能与访问现状

- 服务器本机的首页和健康检查通常在毫秒级返回，CPU 和内存没有明显压力。
- Nginx 已启用 gzip；带哈希的静态资源带一年 `immutable` 缓存。
- 主客户端脚本未压缩约 2.6 MB，gzip 后约 0.7 MB。
- 从维护机器实测公网下载速度会波动，首次访问可能需要数秒；缓存后的再次访问明显更快。
- 音乐文件较大并通过 HTTP Range 流式读取，公网带宽较低时首次起播可能有等待。
- 页面或音乐异常时，先强制刷新，再检查 `static/asset-manifest.json` 与 `static/_assets/sounds/music/`，并查看 Nginx 访问日志是否出现 404。

## 14. 测试与维护入口

常用命令：

```bash
npm run inst
npm run self-host
npm run build-prod
npm run lint
npm test
```

本 fork 为账号、成就、队伍分配、高级设置、首页地图、结算统计、管理员胜负控制和音乐行为增加或更新了对应测试。接手者修改这些模块后，应优先运行相关测试，再根据改动范围运行完整测试。

## 15. 交接边界

- 本文只记录已经实现或已经部署的内容。
- 原 `docs/HistoricalScenarios.zh-CN.md` 是尚未实施的历史场景更新设想，已在本次交接中删除。
- 项目后续设计、功能扩展和上游同步由新的维护者决定。
- 合并新版上游时，账号、房间同步、队伍权限、结算统计、音频资源清单和 `vite.config.ts` 的资源构建逻辑是最容易产生冲突的区域，应逐项回归。
