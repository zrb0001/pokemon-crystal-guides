export interface LevelUpMove {
  level: number;
  move: string;
}

export interface MachineMove {
  move: string;
  tm: string | null;
}

export interface Learnset {
  levelUp: LevelUpMove[];
  machine: MachineMove[];
  egg: { move: string }[];
  tutor: { move: string }[];
}

export interface Pokemon {
  id: number;
  nameEn: string;
  nameZh: string | null;
  genusZh: string | null;
  johtoDex: number | null;
  types: string[];
  stats: Record<string, number>;
  height: number;
  weight: number;
  captureRate: number;
  genderRate: number;
  eggGroups: string[];
  growthRate: string;
  flavorText: string | null;
  evolutionChainId: number;
  learnset: Learnset;
}

export interface Move {
  id: number;
  nameEn: string;
  nameZh: string | null;
  type: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  effectChance: number | null;
  target: string | null;
  effect: string | null;
  flavorZh: string | null;
  machine: string | null;
}

export interface Item {
  id: number;
  nameEn: string;
  nameZh: string | null; // 无官方中文名时为 null，UI 回退显示 nameEn
  category: string; // PokéAPI 类目，如 healing / standard-balls
  pocket: string; // 背包口袋：items/medicine/pokeballs/machines/berries/mail/battle/key
  cost: number;
  effect: string | null; // 英文 short_effect；手写条目为英文功能描述
  flavorZh: string | null; // 官方中文描述；手写条目为自撰中文功能说明
  sprite: string | null; // /sprites/items/{nameEn}.png 或 null
}

/** 某招式的习得者反查结果 */
export interface MoveLearners {
  levelUp: { id: number; level: number }[];
  machine: { id: number; tm: string | null }[];
  egg: { id: number }[];
  tutor: { id: number }[];
}

export interface TypeInfo {
  nameEn: string;
  nameZh: string | null;
}

export interface EvolutionCondition {
  trigger: string;
  minLevel: number | null;
  minHappiness: number | null;
  timeOfDay: string | null;
  item: string | null;
  itemZh: string | null;
  heldItem: string | null;
  heldItemZh: string | null;
  relativePhysicalStats: number | null;
  knownMove: string | null;
  tradeSpecies: string | null;
}

/** 遭遇/获得方式条目（encounters.json，数据源 pokecrystal） */
export interface Encounter {
  loc: string; // 中文地点
  method: string; // grass/swarm/surf/fish-old/fish-good/fish-super/swarm-fish/headbutt/headbutt-rare/rocksmash/contest/static/roam/gift/egg/trade/gamecorner/event/unavailable
  time?: string[]; // morn/day/nite 子集；缺省表示不分时段
  lvMin?: number;
  lvMax?: number;
  rate?: number; // 该时段内遭遇概率（%）
  note?: string;
}

export interface EvolutionNode {
  id: number;
  name: string;
  conditions: EvolutionCondition[];
  evolvesTo: EvolutionNode[];
}
