/**
 * 从 PokéAPI 抓取宝可梦水晶（第二世代）数据并缓存到本地。
 *
 * 输出：
 *   src/data/pokemon/{1..251}.json  每只宝可梦合并数据
 *   src/data/moves.json             图鉴 learnset 引用到的招式（Gen 2 数值）
 *   src/data/items.json             Gen 2 全部道具（合并 scripts/manual-items.json 手写补充）
 *   src/data/types.json             属性中文名映射
 *   src/data/evolutions.json        进化链
 *   public/sprites/{normal,shiny}/{id}.png  水晶版立绘
 *   public/sprites/items/{name}.png 道具图标（后世代官方图，Gen 2 本无图标）
 *
 * 幂等：已存在的缓存文件会跳过。删除后重新运行可刷新。
 * 代理：Node 24+ 通过 NODE_USE_ENV_PROXY=1 让 fetch 读取代理环境变量（见 package.json 脚本）。
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'scripts', '.cache');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const SPRITE_DIR = path.join(ROOT, 'public', 'sprites');
const API = 'https://pokeapi.co/api/v2';
const SPRITE_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-ii/crystal';
const MAX_ID = 251;
const CONCURRENCY = 8;

// 版本组时间顺序，用于把 past_values 换算成水晶版数值
const VERSION_GROUP_ORDER = [
  'red-blue', 'yellow', 'gold-silver', 'crystal',
  'ruby-sapphire', 'emerald', 'firered-leafgreen',
  'diamond-pearl', 'platinum', 'heartgold-soulsilver',
  'black-white', 'black-2-white-2', 'x-y', 'omega-ruby-alpha-sapphire',
  'sun-moon', 'ultra-sun-ultra-moon', 'lets-go-pikachu-lets-go-eevee',
  'sword-shield', 'legends-arceus', 'scarlet-violet',
];
const CRYSTAL_IDX = VERSION_GROUP_ORDER.indexOf('crystal');
const GENERATION_ORDER = [
  'generation-i', 'generation-ii', 'generation-iii', 'generation-iv',
  'generation-v', 'generation-vi', 'generation-vii', 'generation-viii', 'generation-ix',
];
const GEN2_IDX = GENERATION_ORDER.indexOf('generation-ii');

const GEN2_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting',
  'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost',
  'dragon', 'dark', 'steel',
];

// ---------- 基础工具 ----------

const FETCH_INIT = { headers: { 'accept-encoding': 'identity' } };

async function fetchJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, FETCH_INIT);
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 4) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function fetchBinary(url) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, FETCH_INIT);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 5) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/** 带缓存地抓取 API JSON（缓存到 scripts/.cache） */
async function cachedApi(url) {
  const key = url.replace(API + '/', '').replaceAll('/', '__') + '.json';
  const file = path.join(RAW_DIR, key);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {}
  const data = await fetchJson(url);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

/** 简单并发池 */
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

const idFromUrl = (url) => Number(url.replace(/\/$/, '').split('/').pop());

function pickLang(entries, field = 'name') {
  const zh = entries?.find((e) => e.language.name === 'zh-hans');
  if (zh) return zh[field];
  const en = entries?.find((e) => e.language.name === 'en');
  return en ? en[field] : null;
}

/** 只取简体中文，无官方中文名时返回 null（由 UI 回退到英文名） */
function pickZh(entries) {
  return entries?.find((e) => e.language.name === 'zh-hans')?.name ?? null;
}

/**
 * 取“水晶版当时”的数值：past_values/past_types 条目表示“该值在该版本组（含）之前一直有效”，
 * 因此选时间顺序上 ≥ 水晶的最早一条；没有则说明当前值在水晶时已生效。
 */
function pastValue(entries, versionKey, order, targetIdx, valueFields) {
  if (!Array.isArray(entries)) return null;
  let best = null;
  for (const e of entries) {
    const idx = order.indexOf(e[versionKey].name);
    if (idx < targetIdx) continue;
    if (!best || idx < best.idx) best = { idx, e };
  }
  if (!best) return null;
  const out = {};
  for (const f of valueFields) {
    if (best.e[f] !== undefined && best.e[f] !== null) out[f] = best.e[f];
  }
  return out;
}

// ---------- 主流程 ----------

async function main() {
  await mkdir(path.join(DATA_DIR, 'pokemon'), { recursive: true });

  const ids = Array.from({ length: MAX_ID }, (_, i) => i + 1);

  // 1. 抓取 species + pokemon
  console.log('抓取 species / pokemon ...');
  let done = 0;
  await pool(ids, CONCURRENCY, async (id) => {
    await cachedApi(`${API}/pokemon-species/${id}/`);
    await cachedApi(`${API}/pokemon/${id}/`);
    if (++done % 25 === 0) console.log(`  ${done}/${MAX_ID}`);
  });

  // 2. 合并出每只宝可梦的数据，并收集需要追加抓取的招式/进化链
  console.log('合并宝可梦数据 ...');
  const moveNames = new Set();
  const chainIds = new Set();
  const allPokemon = [];

  for (const id of ids) {
    const species = await cachedApi(`${API}/pokemon-species/${id}/`);
    const poke = await cachedApi(`${API}/pokemon/${id}/`);

    // Gen 2 属性
    const pastTypes = pastValue(poke.past_types, 'generation', GENERATION_ORDER, GEN2_IDX, ['types']);
    const types = (pastTypes?.types ?? poke.types).map((t) => t.type.name);

    // 水晶版 learnset
    const learnset = { levelUp: [], machine: [], egg: [], tutor: [] };
    for (const m of poke.moves) {
      for (const d of m.version_group_details) {
        if (d.version_group.name !== 'crystal') continue;
        moveNames.add(m.move.name);
        if (d.move_learn_method.name === 'level-up') {
          learnset.levelUp.push({ level: d.level_learned_at, move: m.move.name });
        } else if (d.move_learn_method.name === 'machine') {
          learnset.machine.push({ move: m.move.name });
        } else if (d.move_learn_method.name === 'egg') {
          learnset.egg.push({ move: m.move.name });
        } else if (d.move_learn_method.name === 'tutor') {
          learnset.tutor.push({ move: m.move.name });
        }
      }
    }
    learnset.levelUp.sort((a, b) => a.level - b.level || a.move.localeCompare(b.move));
    for (const k of ['machine', 'egg', 'tutor']) {
      learnset[k].sort((a, b) => a.move.localeCompare(b.move));
    }

    const flavor = species.flavor_text_entries.find(
      (e) => e.language.name === 'en' && e.version.name === 'crystal',
    );
    const johto = species.pokedex_numbers.find((n) => n.pokedex.name === 'original-johto');

    chainIds.add(idFromUrl(species.evolution_chain.url));

    const merged = {
      id,
      nameEn: species.name,
      nameZh: pickLang(species.names),
      genusZh: pickLang(species.genera, 'genus'),
      johtoDex: johto?.entry_number ?? null,
      types,
      stats: Object.fromEntries(poke.stats.map((s) => [s.stat.name, s.base_stat])),
      height: poke.height,
      weight: poke.weight,
      captureRate: species.capture_rate,
      genderRate: species.gender_rate,
      eggGroups: species.egg_groups.map((g) => g.name),
      growthRate: species.growth_rate.name,
      flavorText: flavor ? flavor.flavor_text.replace(/[\n\f]/g, ' ') : null,
      evolutionChainId: idFromUrl(species.evolution_chain.url),
      learnset,
    };
    await writeFile(path.join(DATA_DIR, 'pokemon', `${id}.json`), JSON.stringify(merged, null, 2));
    allPokemon.push(merged);
  }

  // 3. 招式数据（全部一/二世代的 251 个招式；Gen 2 数值 + 中文名 + 水晶版 TM/HM 编号）
  console.log('抓取招式数据 ...');
  const machineCache = new Map(); // machine url -> 'TM01'
  async function machineLabel(url) {
    if (!machineCache.has(url)) {
      const m = await cachedApi(url);
      machineCache.set(url, m.item.name.toUpperCase().replace('-', ''));
    }
    return machineCache.get(url);
  }
  const moves = {};
  let mdone = 0;
  await pool(ids, CONCURRENCY, async (moveId) => {
    const mv = await cachedApi(`${API}/move/${moveId}/`);
    const override = pastValue(mv.past_values, 'version_group', VERSION_GROUP_ORDER, CRYSTAL_IDX,
      ['power', 'accuracy', 'pp', 'type', 'effect_chance']);
    let machine = null;
    for (const mc of mv.machines ?? []) {
      if (mc.version_group.name === 'crystal') {
        machine = await machineLabel(mc.machine.url);
        break;
      }
    }
    const effect = mv.effect_entries.find((e) => e.language.name === 'en');
    const flavorZh = mv.flavor_text_entries.find((e) => e.language.name === 'zh-hans');
    const target = mv.target?.name ?? null;
    moves[mv.name] = {
      id: mv.id,
      nameEn: mv.name,
      nameZh: pickLang(mv.names),
      type: override?.type?.name ?? mv.type.name,
      power: override?.power ?? mv.power,
      accuracy: override?.accuracy ?? mv.accuracy,
      pp: override?.pp ?? mv.pp,
      priority: mv.priority,
      effectChance: override?.effect_chance ?? mv.effect_chance,
      target,
      effect: effect ? effect.short_effect.replace(/\$effect_chance/g, mv.effect_chance ?? '') : null,
      flavorZh: flavorZh ? flavorZh.flavor_text.replace(/[\n\f]/g, ' ') : null,
      machine,
    };
    if (++mdone % 50 === 0) console.log(`  ${mdone}/${ids.length}`);
  });
  // 兜底：learnset 里引用到但不在 1–251 范围内的招式（理论上没有）
  for (const name of moveNames) {
    if (!moves[name]) console.warn(`警告：learnset 招式 ${name} 缺失`);
  }
  // 把 TM/HM 编号回填到 learnset.machine
  for (const p of allPokemon) {
    for (const entry of p.learnset.machine) entry.tm = moves[entry.move]?.machine ?? null;
    await writeFile(path.join(DATA_DIR, 'pokemon', `${p.id}.json`), JSON.stringify(p, null, 2));
  }
  await writeFile(path.join(DATA_DIR, 'moves.json'), JSON.stringify(moves, null, 2));

  // 3.5 道具数据（game_indices 含 generation-ii 的全部道具 + 手写补充 PokéAPI 缺失的 Gen 2 专有道具）
  console.log('抓取道具数据 ...');
  // 槽位复用导致的伪 Gen 2 条目：后世代道具占用了 Gen 2 的内部编号，PokéAPI 因此带上 generation-ii 索引
  const NOT_GEN2_ITEMS = new Set([
    'cheri-berry', 'chesto-berry', 'pecha-berry', 'rawst-berry', 'aspear-berry',
    'leppa-berry', 'oran-berry', 'persim-berry', 'lum-berry', 'sitrus-berry', // Gen 3 树果，占用 Gen 2 树果槽位
    'silk-scarf', // Gen 3 道具，占用 Pink Bow 槽位
    'hm08', // 水晶版只有 HM01–HM07
  ]);
  const itemList = await cachedApi(`${API}/item?limit=100000`);
  const catPocketCache = new Map(); // 类目名 -> 口袋名
  async function pocketOf(catName) {
    if (!catPocketCache.has(catName)) {
      const c = await cachedApi(`${API}/item-category/${catName}/`);
      catPocketCache.set(catName, c?.pocket?.name ?? 'items');
    }
    return catPocketCache.get(catName);
  }
  const itemSpriteDir = path.join(SPRITE_DIR, 'items');
  const items = {};
  let idone = 0;
  await pool(itemList.results, CONCURRENCY, async (entry) => {
    const it = await cachedApi(entry.url);
    if (!it) return; // 404
    if (!it.game_indices?.some((g) => g.generation.name === 'generation-ii')) return;
    if (NOT_GEN2_ITEMS.has(it.name)) return;
    let sprite = null;
    if (it.sprites?.default) {
      const file = path.join(itemSpriteDir, `${it.name}.png`);
      if (!(await exists(file))) {
        await mkdir(itemSpriteDir, { recursive: true });
        await writeFile(file, await fetchBinary(it.sprites.default));
      }
      sprite = `/sprites/items/${it.name}.png`;
    }
    const effect = it.effect_entries?.find((e) => e.language.name === 'en');
    const flavorZh = it.flavor_text_entries?.find((e) => e.language.name === 'zh-hans');
    let catName = it.category?.name ?? 'unknown';
    let pocket = null;
    if (catName === 'apricorn-box') {
      // PokéAPI 把 7 种球果归入 HGSS 的「球果盒」类目（key 口袋），Gen 2 中球果是普通道具
      catName = 'apricorns';
      pocket = 'items';
    }
    items[it.name] = {
      id: it.id,
      nameEn: it.name,
      nameZh: pickZh(it.names),
      category: catName,
      pocket: pocket ?? (await pocketOf(catName)),
      cost: it.cost ?? 0,
      effect: effect ? effect.short_effect : null,
      flavorZh: flavorZh ? flavorZh.text.replace(/[\n\f]/g, ' ') : null,
      sprite,
    };
    if (++idone % 100 === 0) console.log(`  已处理 ${idone} 个 Gen 2 道具`);
  });
  const manualItems = JSON.parse(
    await readFile(path.join(ROOT, 'scripts', 'manual-items.json'), 'utf8'),
  );
  delete manualItems._comment;
  for (const [name, item] of Object.entries(manualItems)) items[name] = item;
  const sortedItems = Object.fromEntries(
    Object.entries(items).sort((a, b) => a[1].id - b[1].id),
  );
  await writeFile(path.join(DATA_DIR, 'items.json'), JSON.stringify(sortedItems, null, 2));
  console.log(`  共 ${Object.keys(sortedItems).length} 个道具（含手写 ${Object.keys(manualItems).length} 个）`);
  console.log('  类目一览:', [...new Set(Object.values(sortedItems).map((i) => i.category))].sort().join(', '));

  // 4. 属性中文名
  console.log('抓取属性数据 ...');
  const types = {};
  await pool(GEN2_TYPES, CONCURRENCY, async (name) => {
    const t = await cachedApi(`${API}/type/${name}/`);
    types[name] = { nameEn: name, nameZh: pickLang(t.names) };
  });
  await writeFile(path.join(DATA_DIR, 'types.json'), JSON.stringify(types, null, 2));

  // 5. 进化链（含中文道具名）
  console.log(`抓取进化链（${chainIds.size} 条）...`);
  const itemCache = new Map();
  async function itemZh(name) {
    if (!itemCache.has(name)) {
      const it = await cachedApi(`${API}/item/${name}/`);
      itemCache.set(name, pickLang(it.names) ?? name);
    }
    return itemCache.get(name);
  }
  async function parseNode(node) {
    const details = [];
    for (const d of node.evolution_details ?? []) {
      const cond = {
        trigger: d.trigger.name,
        minLevel: d.min_level,
        minHappiness: d.min_happiness,
        timeOfDay: d.time_of_day || null,
        item: d.item?.name ?? null,
        itemZh: d.item ? await itemZh(d.item.name) : null,
        heldItem: d.held_item?.name ?? null,
        heldItemZh: d.held_item ? await itemZh(d.held_item.name) : null,
        relativePhysicalStats: d.relative_physical_stats,
        knownMove: d.known_move?.name ?? null,
        tradeSpecies: d.trade_species?.name ?? null,
      };
      details.push(cond);
    }
    return {
      id: idFromUrl(node.species.url),
      name: node.species.name,
      conditions: details,
      evolvesTo: await Promise.all((node.evolves_to ?? []).map(parseNode)),
    };
  }
  const evolutions = {};
  await pool([...chainIds], CONCURRENCY, async (cid) => {
    const chain = await cachedApi(`${API}/evolution-chain/${cid}/`);
    evolutions[cid] = await parseNode(chain.chain);
  });
  await writeFile(path.join(DATA_DIR, 'evolutions.json'), JSON.stringify(evolutions, null, 2));

  // 6. 立绘
  console.log('下载立绘 ...');
  let sdone = 0;
  await pool(ids, CONCURRENCY, async (id) => {
    for (const variant of ['normal', 'shiny']) {
      const dir = path.join(SPRITE_DIR, variant);
      const file = path.join(dir, `${id}.png`);
      if (await exists(file)) continue;
      await mkdir(dir, { recursive: true });
      const url = variant === 'normal' ? `${SPRITE_BASE}/${id}.png` : `${SPRITE_BASE}/shiny/${id}.png`;
      await writeFile(file, await fetchBinary(url));
    }
    if (++sdone % 25 === 0) console.log(`  ${sdone}/${MAX_ID}`);
  });

  console.log('完成。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
