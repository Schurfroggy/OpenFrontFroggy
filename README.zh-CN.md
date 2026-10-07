# OpenFrontFroggy

> 这是由 Schurfroggy 维护、基于 [OpenFront](https://github.com/openfrontio/OpenFrontIO) 制作的非官方社区修改版。本项目不是 OpenFront 官方发行版，也未获得 OpenFront 团队背书。

简体中文 | [English](README.md)

此版本主要面向小规模朋友服，加入了简体中文本地化、本地账号、成就系统和自定义房间控制。主要改动和上游基线请参阅 [MODIFICATIONS.md](MODIFICATIONS.md)。

[OpenFront.io](https://openfront.io/) 是一款以领土控制和联盟合作为核心的在线即时战略游戏。玩家可以在基于现实世界地理环境制作的多张地图中扩张领土、建造设施，并结成战略联盟。

本项目是 WarFront.io 的分支和重写版本，感谢 [WarFrontIO](https://github.com/WarFrontIO)。

![CI](https://github.com/Schurfroggy/OpenFrontFroggy/actions/workflows/ci.yml/badge.svg)
[![Crowdin](https://badges.crowdin.net/openfront-mls/localized.svg)](https://crowdin.com/project/openfront-mls)
[![CLA assistant](https://cla-assistant.io/readme/badge/openfrontio/OpenFrontIO)](https://cla-assistant.io/openfrontio/OpenFrontIO)
[![许可证：AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![资源许可：CC BY-SA 4.0](https://img.shields.io/badge/Assets-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

## 许可证

OpenFront 源代码采用 **GNU Affero General Public License v3.0** 许可证。

当前版权声明显示在以下位置：

- 页脚：“© OpenFront and Contributors”
- 加载界面：“© OpenFront and Contributors”

修改后的版本必须在适当且清晰可见的位置保留这些声明。

完整要求请参阅 [LICENSE](LICENSE)。

资源许可请参阅 [LICENSE-ASSETS](LICENSE-ASSETS)。
许可证历史请参阅 [LICENSING.md](LICENSING.md)。

## 🌟 功能特色

- **即时战略玩法**：扩张领土并参与战略对抗
- **联盟系统**：与其他玩家结盟，相互协防
- **多种地图**：在欧洲、亚洲、非洲等多个地区的地图上游玩
- **资源管理**：在领土扩张与防御能力之间取得平衡
- **跨平台支持**：可在任何现代浏览器中运行

## 📋 环境要求

- [Node.js](https://nodejs.org/) v24.15.0 或 Node 24 版本线中的更高版本
- [npm](https://www.npmjs.com/) v12.1.0 或 npm 12 版本线中的更高版本
- 现代浏览器（Chrome、Firefox、Edge 等）

Node.js 自带的 npm 版本可能较旧。安装项目依赖前，请先升级 npm：

```bash
npm install --global --ignore-scripts npm@12.1.0
```

## 🚀 安装

1. **克隆仓库**

   ```bash
   git clone https://github.com/Schurfroggy/OpenFrontFroggy.git
   cd OpenFrontFroggy
   ```

2. **安装依赖**

   ```bash
   npm run inst
   ```

   请勿使用 `npm install` 或 `npm i` 安装项目依赖。请使用 `npm run inst`；该命令会执行更安全的 `npm ci --ignore-scripts`，严格按照 `package-lock.json` 中锁定的版本安装依赖，同时不运行生命周期脚本。

   本仓库还会拒绝发布时间不足七天的依赖版本，以及来自 Git、远程 URL、本地压缩包或目录的依赖。更新依赖前，请等待新版本通过七天观察期；安全例外情况必须经过维护者明确审核。

## 🎮 运行游戏

### 开发模式

以开发模式同时运行客户端和服务器，并启用热重载：

```bash
npm run dev
```

该命令将会：

- 启动客户端的 webpack 开发服务器
- 使用开发配置启动游戏服务器
- 在默认浏览器中打开游戏（如需禁用，请设置环境变量 `SKIP_BROWSER_OPEN=true`）

### 仅运行客户端

仅运行客户端并启用热重载：

```bash
npm run start:client
```

### 仅运行服务器

仅使用开发配置运行服务器：

```bash
npm run start:server-dev
```

### 连接预发布或生产环境后端

在回放对局，或测试用户资料、购买及登录流程时，连接生产服务器有时会很有用。

> 回放生产环境中的对局时，请确保本地代码与该对局运行时所用的提交一致。你可以通过 `https://api.openfront.io/game/[gameId]` 查询 `gitCommit` 值。
> 尚未结束的对局无法在本地回放。

连接预发布环境 API 服务器：

```bash
npm run dev:staging
```

连接生产环境 API 服务器：

```bash
npm run dev:prod
```

## 🛠️ 开发工具

- **格式化代码**：

  ```bash
  npm run format
  ```

- **使用 Oxlint 和 ESLint 检查代码**：

  ```bash
  npm run lint
  ```

- **使用 Oxlint 和 ESLint 检查并修复代码**：

  ```bash
  npm run lint:fix
  ```

- **运行测试**：

  ```bash
  npm test
  ```

## 🏗️ 项目结构

- `/src/client` — 游戏前端客户端
- `/src/core` — 确定性游戏模拟核心
- `/src/server` — 游戏后端服务器
- `/resources` — 静态资源（图片、地图等）
- `/zbin` — 用于 Zod schema 的紧凑二进制传输格式（独立实现，仅依赖 Zod）

## 🤝 参与贡献

欢迎提交贡献和翻译！有关贡献流程、已批准议题机制、项目治理和翻译的信息，请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。
