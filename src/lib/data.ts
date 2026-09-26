import type { Pokemon, Move, Item, TypeInfo, EvolutionNode, Encounter } from '../types';
import movesJson from '../data/moves.json';
import itemsJson from '../data/items.json';
import typesJson from '../data/types.json';
import evolutionsJson from '../data/evolutions.json';
import encountersJson from '../data/encounters.json';

const pokemonModules = import.meta.glob<{ default: Pokemon }>('../data/pokemon/*.json', {
  eager: true,
});

const pokemonList: Pokemon[] = Object.values(pokemonModules)
  .map((m) => m.default)
  .sort((a, b) => a.id - b.id);

const moves = movesJson as unknown as Record<string, Move>;
const items = itemsJson as unknown as Record<string, Item>;
const types = typesJson as unknown as Record<string, TypeInfo>;
const evolutions = evolutionsJson as unknown as Record<string, EvolutionNode>;

export function getAllPokemon(): Pokemon[] {
  return pokemonList;
}

export function getPokemon(id: number): Pokemon | undefined {
  return pokemonList.find((p) => p.id === id);
}

export function getMove(name: string): Move | undefined {
  return moves[name];
}

const moveList: Move[] = Object.values(moves).sort((a, b) => a.id - b.id);

export function getAllMoves(): Move[] {
  return moveList;
}

export function getMoveById(id: number): Move | undefined {
  return moveList.find((m) => m.id === id);
}

const itemList: Item[] = Object.values(items).sort((a, b) => a.id - b.id);

export function getAllItems(): Item[] {
  return itemList;
}

export function getItem(name: string): Item | undefined {
  return items[name];
}

export const ITEM_POCKET_NAMES: Record<string, string> = {
  items: '道具',
  medicine: '回复',
  pokeballs: '精灵球',
  machines: '招式机器',
  berries: '树果',
  mail: '邮件',
  battle: '战斗道具',
  key: '重要道具',
  misc: '携带道具',
};

/** 道具类目中文名（PokéAPI 无官方中文类目名，按本站收录的 Gen 2 类目手工映射） */
export const ITEM_CATEGORY_NAMES: Record<string, string> = {
  'standard-balls': '精灵球',
  'apricorn-balls': '球果球',
  apricorns: '球果',
  'all-machines': '招式机器',
  healing: 'HP 回复',
  medicine: '药品',
  'status-cures': '异常治愈',
  revival: '复活',
  'pp-recovery': 'PP 回复',
  vitamins: '营养饮料',
  'stat-boosts': '战斗强化',
  'held-items': '携带道具',
  'type-enhancement': '属性强化',
  'species-specific': '专属道具',
  evolution: '进化道具',
  training: '培育',
  loot: '换钱道具',
  gameplay: '游戏流程',
  'plot-advancement': '剧情道具',
  'event-items': '活动道具',
  spelunking: '探险道具',
  mail: '邮件',
  berries: '树果',
  unused: '特殊',
  unknown: '其他',
};

export function itemCategoryZh(category: string): string {
  return ITEM_CATEGORY_NAMES[category] ?? category;
}

export function itemPocketZh(pocket: string): string {
  return ITEM_POCKET_NAMES[pocket] ?? pocket;
}

const encounters = encountersJson as unknown as Record<string, Encounter[]>;

/** 某宝可梦的遭遇/获得方式（pokecrystal 数据），无记录返回 [] */
export function getEncounters(id: number): Encounter[] {
  return encounters[String(id)] ?? [];
}

/** 在全部进化链中找某宝可梦的直接进化前身 */
export function getPreEvolution(id: number): number | undefined {
  for (const root of Object.values(evolutions)) {
    const found = (function walk(node: EvolutionNode): number | undefined {
      for (const child of node.evolvesTo) {
        if (child.id === id && node.id <= 251) return node.id;
        const r = walk(child);
        if (r) return r;
      }
      return undefined;
    })(root);
    if (found) return found;
  }
  return undefined;
}

/** 反查某招式在水晶版中的习得者 */
export function learnersOf(moveName: string): import('../types').MoveLearners {
  const result: import('../types').MoveLearners = { levelUp: [], machine: [], egg: [], tutor: [] };
  for (const p of pokemonList) {
    for (const e of p.learnset.levelUp) {
      if (e.move === moveName) result.levelUp.push({ id: p.id, level: e.level });
    }
    for (const e of p.learnset.machine) {
      if (e.move === moveName) result.machine.push({ id: p.id, tm: e.tm });
    }
    for (const e of p.learnset.egg) {
      if (e.move === moveName) result.egg.push({ id: p.id });
    }
    for (const e of p.learnset.tutor) {
      if (e.move === moveName) result.tutor.push({ id: p.id });
    }
  }
  return result;
}

export function getTypes(): Record<string, TypeInfo> {
  return types;
}

export function typeZh(name: string): string {
  return types[name]?.nameZh ?? name;
}

export function getEvolutionChain(chainId: number): EvolutionNode | undefined {
  return evolutions[String(chainId)];
}

/** 把进化链树压平成带层级的列表，便于线性渲染 */
export interface FlatEvolution {
  id: number;
  depth: number;
  conditions: EvolutionNode['conditions'];
}

export function flattenChain(root: EvolutionNode): FlatEvolution[] {
  const out: FlatEvolution[] = [];
  (function walk(node: EvolutionNode, depth: number) {
    if (node.id > 251) return; // 水晶版只含前 251 只，剪去后世代进化分支
    out.push({ id: node.id, depth, conditions: node.conditions });
    for (const child of node.evolvesTo) walk(child, depth + 1);
  })(root, 0);
  return out;
}

/** 进化条件 → 中文描述 */
export function conditionText(c: EvolutionNode['conditions'][number]): string {
  const parts: string[] = [];
  if (c.trigger === 'use-item' && c.itemZh) parts.push(`使用${c.itemZh}`);
  if (c.trigger === 'trade') {
    parts.push(c.heldItemZh ? `通信交换（携带${c.heldItemZh}）` : '通信交换');
    if (c.tradeSpecies) parts.push(`与特定宝可梦交换`);
  }
  if (c.minHappiness != null) parts.push(`亲密度${c.timeOfDay === 'day' ? '（白天）' : c.timeOfDay === 'night' ? '（夜晚）' : ''}`);
  if (c.relativePhysicalStats === 1) parts.push('攻击＞防御');
  if (c.relativePhysicalStats === -1) parts.push('攻击＜防御');
  if (c.relativePhysicalStats === 0) parts.push('攻击＝防御');
  if (c.minLevel != null) parts.push(`Lv.${c.minLevel}`);
  if (parts.length === 0 && c.trigger === 'level-up') parts.push('升级');
  if (parts.length === 0) parts.push(c.trigger);
  return parts.join(' · ');
}

export const TARGET_NAMES: Record<string, string> = {
  'selected-pokemon': '任意一只',
  'all-opponents': '对方全体',
  'all-other-pokemon': '场上其他',
  'all-pokemon': '场上全体',
  user: '自身',
  'user-and-allies': '自身与同伴',
  'random-opponent': '随机对手',
  'specific-move': '特定招式',
  'users-field': '己方场地',
  'opponents-field': '对方场地',
  ally: '同伴',
  'entire-field': '整个场地',
};

export const STAT_NAMES: Record<string, string> = {
  hp: 'HP',
  attack: '攻击',
  defense: '防御',
  'special-attack': '特攻',
  'special-defense': '特防',
  speed: '速度',
};

export const STAT_ORDER = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];

export const EGG_GROUP_NAMES: Record<string, string> = {
  monster: '怪兽',
  water1: '水中1',
  water2: '水中2',
  water3: '水中3',
  bug: '虫',
  flying: '飞行',
  ground: '陆上',
  fairy: '妖精',
  plant: '植物',
  humanshape: '人形',
  mineral: '矿物',
  indeterminate: '不定形',
  ditto: '百变怪',
  dragon: '龙',
  'no-eggs': '未发现',
};

export const GROWTH_RATE_NAMES: Record<string, string> = {
  slow: '慢',
  'medium-slow': '较慢',
  medium: '中等',
  fast: '快',
  erratic: '不稳定',
  fluctuating: '波动',
};

/** 第二世代招式物理/特殊由属性决定 */
const PHYSICAL_TYPES = new Set([
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
]);

export function moveCategory(type: string): '物理' | '特殊' {
  return PHYSICAL_TYPES.has(type) ? '物理' : '特殊';
}

/** 第二世代属性相克表：攻击方 → 防守方 → 倍率（仅收录非 1 倍） */
export const TYPE_CHART: Record<string, Record<string, number>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: {
    fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2,
    flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5,
  },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: {
    normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5,
    bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2,
  },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: {
    fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5,
    psychic: 2, ghost: 0.5, dark: 2, steel: 0.5,
  },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5, steel: 0.5 },
  dragon: { dragon: 2, steel: 0.5 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, steel: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5 },
};

/** 攻击方属性打防守方属性的倍率（水晶版） */
export function attackMultiplier(attacker: string, defender: string): number {
  return TYPE_CHART[attacker]?.[defender] ?? 1;
}
