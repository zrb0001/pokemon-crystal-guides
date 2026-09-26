# AGENTS.md

宝可梦水晶版（第二世代）中文静态攻略站。Astro 7 + TypeScript (strict)，数据来自 [PokéAPI](https://pokeapi.co)（按水晶版过滤），构建产物为纯静态文件。

## 常用命令

```bash
npm run fetch-data   # 抓取/更新数据（幂等，已有缓存会跳过）
npm run build-encounters  # 从 pokecrystal 反汇编重建遭遇数据
npm run build        # 构建到 dist/ —— 任何改动后必须通过
npm run preview      # 预览构建产物
npm run dev          # 本地开发
```

## Development

启动开发服务器用后台模式：

```
astro dev --background
```

用 `astro dev stop`、`astro dev status`、`astro dev logs` 管理后台服务器。

## 网络环境

- npm 走镜像 registry.npmmirror.com（最新版本可能滞后，遇到 ETARGET 降一个补丁版本即可）。
- 访问 pokeapi.co / raw.githubusercontent.com 需要代理：

  ```bash
  export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=http://127.0.0.1:7890
  ```

- `fetch-data` 脚本依赖 Node 24+ 的 `NODE_USE_ENV_PROXY=1`（已内置在 npm script 里），且所有请求必须带 `accept-encoding: identity`（undici 不解 brotli，代理链路会拿到压缩乱码）。

## 数据管线

- `scripts/fetch-data.mjs` → 输出到 `src/data/`（`pokemon/{1..251}.json`、`moves.json`、`items.json`、`types.json`、`evolutions.json`，**提交进仓库**）和 `public/sprites/{normal,shiny}/{id}.png`、`public/sprites/items/{name}.png`。
- 道具按 `game_indices` 含 `generation-ii` 过滤；PokéAPI 缺失的 Gen 2 专有道具（水晶版树果/邮件/GS球等约 28 条）手写补充在 `scripts/manual-items.json`（id 9001 起，随 fetch 合并进 `items.json`）。
- PokéAPI 原始响应缓存在 `scripts/.cache/`（不提交）。要刷新某条数据：删掉对应缓存文件和 `src/data/` 产物，重跑 `npm run fetch-data`。
- 遭遇/获得数据**不走 PokéAPI**：`scripts/build-encounters.mjs` 直接解析 pokecrystal 反汇编（路径用 `POKECRYSTAL_DIR` 环境变量，默认 `/tmp/pokecrystal`），输出 `src/data/encounters.json`（**提交进仓库**）。覆盖草丛/大量发生/冲浪/垂钓/撞树/碎岩/捕虫大会；定点、赠品、交换、游戏城兑换、游走、活动配信、无法获得等手写补充在 `scripts/manual-encounters.json`（每条都从 pokecrystal 的 `maps/*.asm`/`engine/**` 核实过），随构建合并。页面经 `getEncounters(id)` 访问。
- 页面不直接读文件，统一走 `src/lib/data.ts` 访问层。

## Gen 2 数据陷阱（改动数值逻辑前必读）

- **属性**：必须用 `pokemon.past_types` 换算（如小磁怪 Gen 2 是电/钢，皮皮是一般系）。
- **招式数值**：用 `move.past_values` 换算到水晶版（撞击威力 35；诅咒是 ??? 属性）。
- **TM/HM**：编号按水晶版，与前作不同（TM24 是龙息；十万伏特不是 TM，是金黄市教学招式）。
- **进化链**：`flattenChain` 已剪掉 id > 251 的后世代分支，不要去掉这个过滤。
- 第二世代**无特性、无性格**；物理/特殊按属性划分（`moveCategory`），不是第四世代起的逐招式分类。
- Gen 2 无官方中文宝可梦描述（详情页用英文水晶版原文）；Gen 2 树果无官方中文名（用英文名+功能描述，不要自行杜撰译名）。
- 攻略内容（`src/pages/guides/`）必须按水晶版核实——金银与水晶有差异（如满金百货店交换是凯西→腕力，烟墨市是哈克龙→嘟嘟利）。

## 结构约定

- 页面：`src/pages/`（`pokemon/`、`moves/` 各含列表 + 详情，`items/` 为单页全道具列表，`guides/` 含菜单 + 子页）。
- 组件：`src/components/`；全站样式在 `src/styles/global.css`，页面局部样式用 `<style>`。
- 新增攻略：在 `src/pages/guides/` 加页面，并在 `guides/index.astro` 的 `guides` 数组里注册。
- UI 文案用简体中文；立绘用 `image-rendering: pixelated` 保持像素风。

## 验证

- 改完必须 `npm run build` 通过（当前 515 个页面）。
- 涉及数值/数据的改动，抽查 `dist/` 里的对应 HTML（如 `grep 关键词 dist/pokemon/25/index.html`）。

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
