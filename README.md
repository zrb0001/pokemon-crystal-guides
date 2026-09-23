# 宝可梦水晶攻略

宝可梦水晶版（第二世代）中文攻略站点，Astro 静态构建，数据来自 [PokéAPI](https://pokeapi.co)（按水晶版过滤）。

## 命令

```bash
npm install          # 安装依赖
npm run fetch-data   # 抓取数据到 src/data/ 与 public/sprites/（幂等，已抓取的会跳过）
npm run dev          # 本地开发
npm run build        # 构建静态站点到 dist/
npm run preview      # 预览构建产物
```

抓取数据需要能访问 pokeapi.co 与 raw.githubusercontent.com；如需代理，先设置环境变量：

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=http://127.0.0.1:7890
```

PokéAPI 原始响应缓存在 `scripts/.cache/`（不提交）；如需刷新某条数据，删除对应缓存文件及 `src/data/` 下的产物后重跑 `npm run fetch-data`。

## 目录

- `scripts/fetch-data.mjs` — 数据抓取/合并脚本（Gen 2 属性、水晶版 learnset、TM/HM 编号、进化链、立绘）
- `src/data/` — 抓取产物（提交进仓库）：`pokemon/{1..251}.json`、`moves.json`、`types.json`、`evolutions.json`
- `public/sprites/` — 水晶版立绘（普通 + 闪光）
- `src/pages/` — 首页、图鉴（列表+详情）、招式（列表+详情）
- `src/lib/data.ts` — 数据访问层
