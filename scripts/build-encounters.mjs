#!/usr/bin/env node
/**
 * 从 pokecrystal 反汇编（宝可梦水晶版权威源码）解析全部遭遇/获得数据，
 * 生成 src/data/encounters.json（提交进仓库）。
 *
 * 数据源（$POKECRYSTAL_DIR，默认 /tmp/pokecrystal）：
 *   data/wild/johto_grass.asm / kanto_grass.asm  草丛（每时段 7 槽，概率 30/30/20/10/5/4/1）
 *   data/wild/swarm_grass.asm                    大量发生草丛（替换该地图普通草丛表）
 *   data/wild/johto_water.asm / kanto_water.asm  冲浪（3 槽，60/30/10）
 *   data/wild/fish.asm                           垂钓（13 组 × 3 钓竿，累积阈值 + TimeFishGroups）
 *   data/wild/treemons.asm + treemon_maps.asm    撞树（common/rare）与碎岩
 *   data/wild/bug_contest_mons.asm               捕虫大会
 *   data/maps/maps.asm                           地图 → 垂钓组
 *   scripts/manual-encounters.json               定点/赠品/交换等手写数据（从 maps/*.asm 逐一核实）
 *
 * 垂钓地图的认定：有 def_water_wildmons（冲浪表）的地图才有可垂钓水面
 * （maps.asm 里大量室内地图挂着默认的 FISHGROUP_SHORE，属于无意义默认值）。
 *
 * 概率换算（engine/events/fish.asm + macros/data.asm）：
 *   percent 宏 = 截断(p * 255 / 100)；随机数 a ∈ [0,255]，a ≤ 阈值即命中，
 *   故单条概率 = (本阈值 − 上一条阈值) / 256，最后一条必为 100 percent (=255)。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.POKECRYSTAL_DIR || '/tmp/pokecrystal';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(DIR, p), 'utf8');

function fail(msg) {
  throw new Error(`build-encounters: ${msg}`);
}

// ---------------------------------------------------------------------------
// 物种常量 → 全国图鉴号
// ---------------------------------------------------------------------------
const SPECIES_TO_ID = (() => {
  const out = {};
  let id = 0;
  let started = false;
  for (const line of read('constants/pokemon_constants.asm').split('\n')) {
    if (/const_def 1/.test(line)) {
      started = true;
      continue;
    }
    if (!started) continue;
    const m = line.match(/^\s*const (\w+)/);
    if (m) out[m[1]] = ++id;
  }
  if (out.BULBASAUR !== 1 || out.CELEBI !== 251) {
    fail(`物种常量解析异常 (BULBASAUR=${out.BULBASAUR}, CELEBI=${out.CELEBI})`);
  }
  return out;
})();

function speciesId(name) {
  const id = SPECIES_TO_ID[name];
  if (!id || id > 251) fail(`未知物种常量: ${name}`);
  return id;
}

// ---------------------------------------------------------------------------
// 地图常量 → maps.asm 条目（地标、垂钓组）
// ---------------------------------------------------------------------------
const MAP_INFO = (() => {
  const consts = [];
  for (const line of read('constants/map_constants.asm').split('\n')) {
    const m = line.match(/^\s*map_const (\w+),/);
    if (m) consts.push(m[1]);
  }
  const byNorm = new Map(consts.map((c) => [c.replace(/_/g, ''), c]));

  const out = new Map(); // MAP_CONST -> { landmark, fishgroup }
  for (const line of read('data/maps/maps.asm').split('\n')) {
    const m = line.match(/^\s*map (\w+), [^,]+, [^,]+, (LANDMARK_\w+), [^,]+, (?:TRUE|FALSE), [^,]+, (FISHGROUP_\w+)\s*$/);
    if (!m) continue;
    const key = byNorm.get(m[1].toUpperCase().replace(/_/g, ''));
    if (!key) fail(`maps.asm 中的地图 ${m[1]} 找不到对应 map_const`);
    out.set(key, { landmark: m[2], fishgroup: m[3] });
  }
  if (out.size < 300) fail(`maps.asm 解析条目过少: ${out.size}`);
  return out;
})();

// ---------------------------------------------------------------------------
// 地图常量 → 中文地名（覆盖全部遭遇相关地图；缺漏会在断言中暴露）
// ---------------------------------------------------------------------------
const MAP_ZH = {
  SPROUT_TOWER_2F: '喇叭芽之塔 2F',
  SPROUT_TOWER_3F: '喇叭芽之塔 3F',
  TIN_TOWER_2F: '铃铛塔 2F',
  TIN_TOWER_3F: '铃铛塔 3F',
  TIN_TOWER_4F: '铃铛塔 4F',
  TIN_TOWER_5F: '铃铛塔 5F',
  TIN_TOWER_6F: '铃铛塔 6F',
  TIN_TOWER_7F: '铃铛塔 7F',
  TIN_TOWER_8F: '铃铛塔 8F',
  TIN_TOWER_9F: '铃铛塔 9F',
  BURNED_TOWER_1F: '烧焦塔 1F',
  BURNED_TOWER_B1F: '烧焦塔 B1F',
  NATIONAL_PARK: '自然公园',
  RUINS_OF_ALPH_OUTSIDE: '阿露福遗迹（外部）',
  RUINS_OF_ALPH_INNER_CHAMBER: '阿露福遗迹（内部房间）',
  UNION_CAVE_1F: '连接洞窟 1F',
  UNION_CAVE_B1F: '连接洞窟 B1F',
  UNION_CAVE_B2F: '连接洞窟 B2F',
  SLOWPOKE_WELL_B1F: '呆呆兽之井 B1F',
  SLOWPOKE_WELL_B2F: '呆呆兽之井 B2F',
  ILEX_FOREST: '栎树林',
  LAKE_OF_RAGE: '愤怒之湖',
  DARK_CAVE_VIOLET_ENTRANCE: '黑暗洞窟（桔梗市入口）',
  DARK_CAVE_BLACKTHORN_ENTRANCE: '黑暗洞窟（烟墨市入口）',
  MOUNT_MORTAR_1F_OUTSIDE: '擂钵山 1F（外侧）',
  MOUNT_MORTAR_1F_INSIDE: '擂钵山 1F（内侧）',
  MOUNT_MORTAR_2F_INSIDE: '擂钵山 2F',
  MOUNT_MORTAR_B1F: '擂钵山 B1F',
  ICE_PATH_1F: '冰雪小径 1F',
  ICE_PATH_B1F: '冰雪小径 B1F',
  ICE_PATH_B2F_MAHOGANY_SIDE: '冰雪小径 B2F（卡吉镇侧）',
  ICE_PATH_B2F_BLACKTHORN_SIDE: '冰雪小径 B2F（烟墨市侧）',
  ICE_PATH_B3F: '冰雪小径 B3F',
  DRAGONS_DEN_B1F: '龙穴 B1F',
  WHIRL_ISLAND_NW: '漩涡岛 西北',
  WHIRL_ISLAND_NE: '漩涡岛 东北',
  WHIRL_ISLAND_SW: '漩涡岛 西南',
  WHIRL_ISLAND_SE: '漩涡岛 东南',
  WHIRL_ISLAND_CAVE: '漩涡岛 通道洞窟',
  WHIRL_ISLAND_B1F: '漩涡岛 B1F',
  WHIRL_ISLAND_B2F: '漩涡岛 B2F',
  WHIRL_ISLAND_LUGIA_CHAMBER: '漩涡岛 最深处',
  SILVER_CAVE_OUTSIDE: '白银山（山脚）',
  SILVER_CAVE_ROOM_1: '白银山 洞窟 1',
  SILVER_CAVE_ROOM_2: '白银山 洞窟 2',
  SILVER_CAVE_ROOM_3: '白银山 洞窟 3',
  SILVER_CAVE_ITEM_ROOMS: '白银山 道具洞窟',
  MOUNT_MOON: '月见山',
  ROCK_TUNNEL_1F: '岩山隧道 1F',
  ROCK_TUNNEL_B1F: '岩山隧道 B1F',
  DIGLETTS_CAVE: '地鼠洞穴',
  VICTORY_ROAD: '冠军之路',
  TOHJO_FALLS: '都城瀑布',
  OLIVINE_PORT: '浅葱港',
  VERMILION_PORT: '枯叶港',
  NEW_BARK_TOWN: '若叶镇',
  CHERRYGROVE_CITY: '吉花市',
  VIOLET_CITY: '桔梗市',
  AZALEA_TOWN: '桧皮镇',
  GOLDENROD_CITY: '满金市',
  ECRUTEAK_CITY: '缘朱市',
  OLIVINE_CITY: '浅葱市',
  CIANWOOD_CITY: '湛蓝市',
  MAHOGANY_TOWN: '卡吉镇',
  BLACKTHORN_CITY: '烟墨市',
  PALLET_TOWN: '真新镇',
  VIRIDIAN_CITY: '常青市',
  PEWTER_CITY: '深灰市',
  CERULEAN_CITY: '华蓝市',
  VERMILION_CITY: '枯叶市',
  LAVENDER_TOWN: '紫苑镇',
  CELADON_CITY: '玉虹市',
  SAFFRON_CITY: '金黄市',
  FUCHSIA_CITY: '浅红市',
  CINNABAR_ISLAND: '红莲镇',
};

function locZh(mapConst) {
  const route = mapConst.match(/^ROUTE_(\d+)(?:_(NORTH|SOUTH))?$/);
  if (route) return `${Number(route[1])}号道路${route[2] ? `（${route[2] === 'NORTH' ? '北' : '南'}）` : ''}`;
  const zh = MAP_ZH[mapConst];
  if (!zh) fail(`缺少地图中文名: ${mapConst}`);
  return zh;
}

// ---------------------------------------------------------------------------
// 结果累积
//   野生遭遇：同一宝可梦 + 同一地图 + 同一方式 + 同一时段的多个槽位先合并
//   （概率求和、等级取 min-max）；输出时再把 (loc|method|rate|lv|note) 相同
//   的时段并成一条。手写条目（manual）按原样追加。
// ---------------------------------------------------------------------------
/** @type {Map<number, Map<string, object>>} id -> key -> entry */
const byId = new Map();
/** @type {Map<number, object[]>} id -> 手写条目 */
const manualById = new Map();

function addSlot(id, { loc, method, times, level, lvMin, lvMax, rate, note }) {
  if (!byId.has(id)) byId.set(id, new Map());
  const entries = byId.get(id);
  const timeKey = times ? times.join(',') : '';
  const key = [loc, method, timeKey, note ?? ''].join('|');
  const lo = level ?? lvMin;
  const hi = level ?? lvMax;
  const existing = entries.get(key);
  if (existing) {
    existing.rate += rate;
    existing.lvMin = Math.min(existing.lvMin, lo);
    existing.lvMax = Math.max(existing.lvMax, hi);
    return;
  }
  entries.set(key, {
    loc,
    method,
    ...(times ? { time: [...times] } : {}),
    lvMin: lo,
    lvMax: hi,
    rate,
    ...(note ? { note } : {}),
  });
}

function addManual(e) {
  const { id, ...rest } = e;
  if (!manualById.has(id)) manualById.set(id, []);
  manualById.get(id).push(rest);
}

const TIMES = ['morn', 'day', 'nite'];

// ---------------------------------------------------------------------------
// 草丛（johto/kanto）与大量发生草丛（swarm）
// ---------------------------------------------------------------------------
const GRASS_SLOT_PROBS = [30, 30, 20, 10, 5, 4, 1]; // data/wild/probabilities.asm GrassMonProbTable

function parseGrassFile(path, method) {
  const lines = read(path).split('\n');
  let map = null;
  let time = null;
  let slot = 0;
  let count = 0;
  const flushCheck = () => {
    if (map && slot !== 0 && slot % 7 !== 0) fail(`${path} ${map} 槽位数异常: ${slot}`);
  };
  for (const raw of lines) {
    const line = raw.trim();
    let m = line.match(/^(?:def_grass_wildmons|map_id) (\w+)/);
    if (m) {
      flushCheck();
      map = m[1];
      time = null;
      slot = 0;
      continue;
    }
    if (!map) continue;
    if (/^end_grass_wildmons|^db -1/.test(line)) {
      flushCheck();
      if (slot !== 21) fail(`${path} ${map} 应有 21 个槽位，实际 ${slot}`);
      map = null;
      continue;
    }
    const tc = raw.match(/; (morn|day|nite)\s*$/);
    if (tc && !/^db /.test(line)) {
      time = tc[1];
      continue;
    }
    if (/percent/.test(line)) continue; // 遇敌率行（展示时忽略）
    m = line.match(/^db\s+(\d+),\s*(\w+)\s*(;.*)?$/);
    if (m) {
      if (!time) fail(`${path} ${map} 缺少时段注释`);
      const prob = GRASS_SLOT_PROBS[slot % 7];
      addSlot(speciesId(m[2]), {
        loc: locZh(map),
        method,
        times: [time],
        level: +m[1],
        rate: prob,
        ...(method === 'swarm' ? { note: '大量发生时（NPC 电话通知），替换该地图普通草丛' } : {}),
      });
      slot++;
      count++;
    }
  }
  return count;
}

const grassCount =
  parseGrassFile('data/wild/johto_grass.asm', 'grass') +
  parseGrassFile('data/wild/kanto_grass.asm', 'grass') +
  parseGrassFile('data/wild/swarm_grass.asm', 'swarm');
if (grassCount === 0) fail('草丛解析为 0 条');

// ---------------------------------------------------------------------------
// 冲浪
// ---------------------------------------------------------------------------
const WATER_SLOT_PROBS = [60, 30, 10]; // WaterMonProbTable

function parseWaterFile(path) {
  const lines = read(path).split('\n');
  let map = null;
  let slot = 0;
  let count = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const m0 = line.match(/^def_water_wildmons (\w+)/);
    if (m0) {
      map = m0[1];
      slot = 0;
      continue;
    }
    if (!map) continue;
    if (/^end_water_wildmons/.test(line)) {
      if (slot !== 3) fail(`${path} ${map} 应有 3 个槽位，实际 ${slot}`);
      map = null;
      continue;
    }
    const m = line.match(/^db\s+(\d+),\s*(\w+)\s*(;.*)?$/);
    if (m) {
      addSlot(speciesId(m[2]), {
        loc: locZh(map),
        method: 'surf',
        times: TIMES,
        level: +m[1],
        rate: WATER_SLOT_PROBS[slot],
      });
      slot++;
      count++;
    }
  }
  return count;
}

const waterCount = parseWaterFile('data/wild/johto_water.asm') + parseWaterFile('data/wild/kanto_water.asm');
if (waterCount === 0) fail('冲浪解析为 0 条');

// ---------------------------------------------------------------------------
// 垂钓
// ---------------------------------------------------------------------------
const pctByte = (pct, plusOne) => Math.floor((pct * 255) / 100) + (plusOne ? 1 : 0);

const FISH = (() => {
  const lines = read('data/wild/fish.asm').split('\n');
  // 1) FishGroups 表：组序号 → 三根钓竿表的标签
  const groupTables = []; // [{old, good, super}]
  // 2) 各钓竿表：标签 -> [{threshold, species|null, timeGroup|null, level}]
  const tables = new Map();
  // 3) TimeFishGroups：index -> {day:{species,level}, nite:{species,level}}
  const timeGroups = [];

  let section = 'header';
  let pendingLabels = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^FishGroups:/.test(line)) {
      section = 'groups';
      continue;
    }
    if (/^TimeFishGroups:/.test(line)) {
      section = 'time';
      pendingLabels = [];
      continue;
    }
    if (section === 'groups') {
      const m = line.match(/^fishgroup .*?(\.\w+),\s*(\.\w+),\s*(\.\w+)/);
      if (m) {
        groupTables.push({ old: m[1].slice(1), good: m[2].slice(1), super: m[3].slice(1) });
        continue;
      }
      // 遇到第一个表标签即进入 tables 段
      if (/^\.\w+:/.test(line)) section = 'tables';
      else continue;
    }
    if (section === 'time') {
      const m = line.match(/^db\s+(\w+),\s*(\d+),\s*(\w+),\s*(\d+)\s*(;.*)?$/);
      if (m) {
        timeGroups.push({
          day: { species: m[1], level: +m[2] },
          nite: { species: m[3], level: +m[4] },
        });
      }
      continue;
    }
    // section === 'tables'；连续标签互为别名（如 .Qwilfish_NoSwarm_Old 与 .Qwilfish_Old 共享数据）
    const label = line.match(/^\.(\w+):/);
    if (label) {
      if (pendingLabels.every((l) => tables.get(l).length === 0)) {
        // 尚无数据的标签序列：追加别名
        pendingLabels.push(label[1]);
        if (!tables.has(label[1])) tables.set(label[1], []);
      } else {
        pendingLabels = [label[1]];
        if (!tables.has(label[1])) tables.set(label[1], []);
      }
      continue;
    }
    const m = line.match(/^db\s+(\d+) percent(\s*\+\s*1)?,\s*(\w+)(?:\s+(\d+))?(?:,\s*(\d+))?\s*(;.*)?$/);
    if (m && pendingLabels.length) {
      const threshold = pctByte(+m[1], !!m[2]);
      const what = m[3];
      const entry = { threshold };
      if (what === 'time_group') {
        entry.timeGroup = +m[4];
      } else {
        entry.species = what;
        entry.level = +m[5];
      }
      for (const l of pendingLabels) tables.get(l).push({ ...entry });
    }
  }
  if (groupTables.length !== 13) fail(`FishGroups 应有 13 组，实际 ${groupTables.length}`);

  // 校验 + 展开：每张表阈值严格递增、最后 = 255，概率和 = 100%
  const expanded = new Map(); // label -> [{species, level|null, timeGroup|null, rate}]
  for (const [label, entries] of tables) {
    if (!entries.length) continue;
    let prev = -1;
    const raw = entries.map((e, i) => {
      if (e.threshold <= prev) fail(`垂钓表 ${label} 阈值非递增 (第 ${i + 1} 条)`);
      const count = e.threshold - prev;
      prev = e.threshold;
      return { ...e, count };
    });
    if (prev !== 255) fail(`垂钓表 ${label} 最后阈值应为 255，实际 ${prev}`);
    const sum = raw.reduce((s, e) => s + e.count, 0);
    if (sum !== 256) fail(`垂钓表 ${label} 计数和应为 256，实际 ${sum}`);
    // /256 → 百分比，最大余数法取整保证和 = 100
    const floors = raw.map((e) => Math.floor((e.count * 100) / 256));
    let deficit = 100 - floors.reduce((s, v) => s + v, 0);
    const order = raw
      .map((e, i) => [i, (e.count * 100) % 256])
      .sort((a, b) => b[1] - a[1]);
    for (let k = 0; k < deficit; k++) floors[order[k][0]]++;
    expanded.set(
      label,
      raw.map((e, i) => ({
        species: e.species ?? null,
        level: e.level ?? null,
        timeGroup: e.timeGroup ?? null,
        rate: floors[i],
      })),
    );
  }
  return { groupTables, tables: expanded, timeGroups };
})();

// FISHGROUP_* 常量顺序 = FishGroups 表顺序（FISHGROUP_NONE 占位 0）
const FISHGROUP_CONSTS = (() => {
  const out = [];
  for (const line of read('constants/map_data_constants.asm').split('\n')) {
    const m = line.match(/^\s*const (FISHGROUP_\w+)/);
    if (m) out.push(m[1]);
  }
  if (out[0] !== 'FISHGROUP_NONE' || out.length !== 14) fail(`FISHGROUP 常量解析异常: ${out.length}`);
  return out;
})();

const ROD_METHOD = { old: 'fish-old', good: 'fish-good', super: 'fish-super' };
const ROD_ZH = { old: '破旧钓竿', good: '好钓竿', super: '厉害钓竿' };

function addFishing(mapConst, groupConst, methodOverride = null, note = null) {
  const idx = FISHGROUP_CONSTS.indexOf(groupConst);
  if (idx < 1) fail(`${mapConst} 的垂钓组无效: ${groupConst}`);
  const tables = FISH.groupTables[idx - 1];
  const loc = locZh(mapConst);
  for (const rod of ['old', 'good', 'super']) {
    const entries = FISH.tables.get(tables[rod]);
    if (!entries) fail(`垂钓表缺失: ${tables[rod]}`);
    // 方法被覆写时（大量发生组）把钓竿名并进备注，避免不同钓竿的概率被错误求和
    const entryNote = methodOverride && note ? `${note}，${ROD_ZH[rod]}` : note;
    for (const e of entries) {
      const targets = [];
      if (e.species) {
        targets.push({ id: speciesId(e.species), level: e.level, times: [...TIMES] });
      } else {
        const tg = FISH.timeGroups[e.timeGroup];
        if (!tg) fail(`TimeFishGroups[${e.timeGroup}] 缺失 (${tables[rod]})`);
        targets.push({ id: speciesId(tg.day.species), level: tg.day.level, times: ['morn', 'day'] });
        if (tg.nite.species !== tg.day.species || tg.nite.level !== tg.day.level) {
          targets.push({ id: speciesId(tg.nite.species), level: tg.nite.level, times: ['nite'] });
        } else {
          targets[0].times = [...TIMES];
        }
      }
      for (const t of targets) {
        addSlot(t.id, {
          loc,
          method: methodOverride ?? ROD_METHOD[rod],
          times: t.times,
          level: t.level,
          rate: e.rate,
          ...(entryNote ? { note: entryNote } : {}),
        });
      }
    }
  }
}

// 垂钓挂在有冲浪水面的地图上（maps.asm 的 FISHGROUP_SHORE 是室内地图的默认垃圾值）
const fishMaps = [];
for (const f of ['data/wild/johto_water.asm', 'data/wild/kanto_water.asm']) {
  for (const line of read(f).split('\n')) {
    const m = line.match(/def_water_wildmons (\w+)/);
    if (m) fishMaps.push(m[1]);
  }
}
for (const mapConst of fishMaps) {
  const info = MAP_INFO.get(mapConst);
  if (!info) fail(`${mapConst} 不在 maps.asm 中`);
  // 4号道路/华蓝市/玉虹市：有冲浪水面但垂钓组为 NONE，水晶版里钓不到任何东西
  if (info.fishgroup === 'FISHGROUP_NONE') continue;
  addFishing(mapConst, info.fishgroup);
  // 大量发生垂钓（engine/events/fish.asm GetFishGroupIndex）：
  // FISHGROUP_QWILFISH 大量发生时切换为 FISHGROUP_QWILFISH_SWARM。
  // FISHGROUP_REMORAID 没有任何地图使用，铁炮鱼大量发生组在水晶版为不可达数据。
  if (info.fishgroup === 'FISHGROUP_QWILFISH') {
    addFishing(mapConst, 'FISHGROUP_QWILFISH_SWARM', 'swarm-fish', '大量发生时（钓客拉尔夫电话通知）');
  }
}

// ---------------------------------------------------------------------------
// 撞树 / 碎岩
// ---------------------------------------------------------------------------
const TREE = (() => {
  const lines = read('data/wild/treemons.asm').split('\n');
  const sets = new Map(); // name -> { common: [], rare: [] }（Rock 只有一段）
  let current = null;
  let segment = 'common';
  for (const raw of lines) {
    const line = raw.trim();
    const label = line.match(/^(TreeMonSet_\w+):/);
    if (label) {
      current = label[1];
      segment = 'common';
      sets.set(current, { common: [], rare: [] });
      continue;
    }
    if (!current) continue;
    if (/^; rare/.test(line)) {
      segment = 'rare';
      continue;
    }
    if (/^db -1/.test(line)) continue;
    const m = line.match(/^db\s+(\d+),\s*(\w+),\s*(\d+)/);
    if (m) sets.get(current)[segment].push({ rate: +m[1], species: m[2], level: +m[3] });
  }
  // 断言：每段概率和 = 100（None 无数据，Rock 只有 common 段）
  for (const [name, segs] of sets) {
    if (name === 'TreeMonSet_None') continue;
    for (const [seg, entries] of Object.entries(segs)) {
      if (!entries.length) continue;
      const sum = entries.reduce((s, e) => s + e.rate, 0);
      if (sum !== 100) fail(`${name} ${seg} 段概率和应为 100，实际 ${sum}`);
    }
  }
  return sets;
})();

function parseTreeMonMaps(lines, method) {
  let count = 0;
  for (const raw of lines) {
    const m = raw.match(/treemon_map (\w+),\s*(TREEMON_SET_\w+)/);
    if (!m) continue;
    const [, mapConst, setConst] = m;
    const setSuffix = setConst.replace('TREEMON_SET_', '');
    const setName = `TreeMonSet_${setSuffix[0]}${setSuffix.slice(1).toLowerCase()}`;
    const set = TREE.get(setName);
    if (!set) fail(`未知撞树组: ${setConst}`);
    if (!set.common.length && !set.rare.length) continue; // TREEMON_SET_NONE
    const loc = locZh(mapConst);
    for (const [seg, entries] of Object.entries(set)) {
      if (!entries.length) continue;
      const segMethod = method === 'rocksmash' ? 'rocksmash' : seg === 'rare' ? 'headbutt-rare' : 'headbutt';
      for (const e of entries) {
        addSlot(speciesId(e.species), {
          loc,
          method: segMethod,
          times: TIMES,
          level: e.level,
          rate: e.rate,
          ...(method === 'rocksmash' ? { note: '碎岩仅 40% 概率触发战斗' } : {}),
        });
        count++;
      }
    }
  }
  return count;
}

{
  const text = read('data/wild/treemon_maps.asm');
  const [treePart, rockPart] = text.split(/^RockMonMaps:$/m);
  if (!rockPart) fail('treemon_maps.asm 缺少 RockMonMaps');
  const n1 = parseTreeMonMaps(treePart.split('\n'), 'headbutt');
  const n2 = parseTreeMonMaps(rockPart.split('\n'), 'rocksmash');
  if (n1 === 0 || n2 === 0) fail(`撞树/碎岩解析异常: ${n1}/${n2}`);
}

// ---------------------------------------------------------------------------
// 捕虫大会（自然公园，每周二/四/六）
// ---------------------------------------------------------------------------
{
  const lines = read('data/wild/bug_contest_mons.asm').split('\n');
  let sum = 0;
  let count = 0;
  for (const raw of lines) {
    const m = raw.match(/db\s+(-?\d+), (\w+),\s*(\d+), (\d+)/);
    if (!m) continue;
    // 末行 db -1, VENOMOTH 是表终止符：前面 10 条概率已凑满 100，
    // ChooseWildEncounter_BugContest 的减法循环永远不会落到它身上。
    if (+m[1] === -1) continue;
    sum += +m[1];
    addSlot(speciesId(m[2]), {
      loc: '自然公园',
      method: 'contest',
      lvMin: +m[3],
      lvMax: +m[4],
      rate: +m[1],
      note: '捕虫大会（每周二/四/六）',
    });
    count++;
  }
  if (count !== 10 || sum !== 100) fail(`捕虫大会解析异常: ${count} 条, 和 ${sum}`);
}

// ---------------------------------------------------------------------------
// 合并手写数据（定点/赠品/交换/兑换/游走/活动/无法获得）
// ---------------------------------------------------------------------------
const manual = JSON.parse(readFileSync(join(ROOT, 'scripts/manual-encounters.json'), 'utf8'));
for (const e of manual) {
  if (!e.id || e.id < 1 || e.id > 251) fail(`manual 条目 id 异常: ${JSON.stringify(e)}`);
  if (!e.loc || !e.method) fail(`manual 条目缺 loc/method: ${JSON.stringify(e)}`);
  addManual({
    id: e.id,
    loc: e.loc,
    method: e.method,
    ...(e.time ? { time: e.time } : {}),
    ...(e.lv != null ? { lvMin: e.lv, lvMax: e.lv } : {}),
    ...(e.rate != null ? { rate: e.rate } : {}),
    ...(e.note ? { note: e.note } : {}),
  });
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
const METHOD_ORDER = [
  'grass', 'swarm', 'surf',
  'fish-old', 'fish-good', 'fish-super', 'swarm-fish',
  'headbutt', 'headbutt-rare', 'rocksmash',
  'contest', 'static', 'roam', 'gift', 'egg', 'trade', 'gamecorner', 'event', 'unavailable',
];

const TIME_SORT = { morn: 0, day: 1, nite: 2 };

const allIds = new Set([...byId.keys(), ...manualById.keys()]);
const out = {};
let total = 0;
for (const id of [...allIds].sort((a, b) => a - b)) {
  // 野生条目：(loc|method|rate|lvMin|lvMax|note) 相同的时段并成一条
  const grouped = new Map();
  for (const e of (byId.get(id) ?? new Map()).values()) {
    const key = [e.loc, e.method, e.rate, e.lvMin, e.lvMax, e.note ?? ''].join('|');
    const g = grouped.get(key);
    if (g) {
      for (const t of e.time ?? []) if (!g.time.includes(t)) g.time.push(t);
    } else {
      grouped.set(key, { ...e, ...(e.time ? { time: [...e.time] } : {}) });
    }
  }
  const arr = [...grouped.values(), ...(manualById.get(id) ?? [])];
  for (const e of arr) e.time?.sort((a, b) => TIME_SORT[a] - TIME_SORT[b]);
  arr.sort(
    (a, b) =>
      METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method) || a.loc.localeCompare(b.loc, 'zh'),
  );
  out[String(id)] = arr;
  total += arr.length;
}

const covered = Object.keys(out).length;
if (covered < 150) fail(`覆盖物种过少: ${covered}`);

writeFileSync(join(ROOT, 'src/data/encounters.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`encounters.json: ${covered} 种宝可梦, ${total} 条记录`);

// 打印无记录物种，供人工核对「无法获得/仅进化获得」
const missing = [];
for (let id = 1; id <= 251; id++) if (!out[String(id)]) missing.push(id);
console.log(`无遭遇记录 ${missing.length} 种: ${missing.join(', ')}`);
