'use strict';
/**
 * Config – konstanty a definice herních prvků.
 */
const Config = {
  TILE: 16,                // velikost políčka ve "světových pixelech"
  MAP_W: 120,
  MAP_H: 120,
  TPS: 30,                 // simulační ticky za sekundu při rychlosti 1x
  MIN_PER_TICK: 0.1,       // herní minuty za tick → 1 herní hodina = 20 s při 1x
  CARRY: 40,               // kolik kusů unese kolonista
  STACK: 75,               // max. velikost hromádky na políčku
  ZOOM_MIN: 0.9,
  ZOOM_MAX: 6,
  ZOOM_DEFAULT: 2.6,
  CROP_HOURS: 42,          // doba růstu plodiny (herní hodiny při plodnosti 1)
  BUSH_REGROW_HOURS: 40,
  TREE_GROW_PER_HOUR: 0.004,
  SPEEDS: [0, 1, 2, 3, 4],
  AUTO_FAST_SPEED: 10,     // rychlost, když všichni spí (volitelné)
  BATCH_RADIUS: 8,
  SEASON_DAYS: 4,          // délka ročního období ve dnech (rok = 16 dní)
  SPOIL_HOURS: { food: 72, meal: 120 },   // trvanlivost potravin venku (herní hodiny)
  CHEST_STACK: 300,        // kapacita truhly
  ROOM_MAX: 300,           // největší prostor, který se ještě zastřeší
  MAX_COLONISTS: 8,
  ORE_AMOUNT: 200,         // zásoba jednoho políčka ložiska
  ORE_PER_MINE: 3,         // kolik rudy vytěží kolonista jedním úkolem
  BELT_PERIOD: 10,         // ticků mezi posuny pásu
  BELT_RATE: 2,            // kusů přesunutých jedním posunem
  BELT_STACK: 8,           // max. kusů na políčku pásu
  POWER_LINK: 7,           // dosah propojení zdrojů a sloupů (políčka)
  POWER_REACH: 5,          // dosah napájení strojů od zdroje / sloupu
  RESEARCH_RATE: 0.009,    // bodů výzkumu za tick práce při rychlosti 1         // dosah pro hromadné zásobování sousedních plánů
};
Config.HOURS_PER_TICK = Config.MIN_PER_TICK / 60;

// Typy terénu
const T = { WATER: 0, SHALLOW: 1, SAND: 2, GRASS: 3, SOIL: 4, DIRT: 5, GRAVEL: 6 };
const TERRAIN = [
  { id: 'water',   name: 'Hluboká voda',  walk: false, cost: 1,    fert: 0 },
  { id: 'shallow', name: 'Mělká voda',    walk: true,  cost: 2.6,  fert: 0 },
  { id: 'sand',    name: 'Písek',         walk: true,  cost: 1.2,  fert: 0 },
  { id: 'grass',   name: 'Tráva',         walk: true,  cost: 1,    fert: 1.0 },
  { id: 'soil',    name: 'Úrodná půda',   walk: true,  cost: 1,    fert: 1.4 },
  { id: 'dirt',    name: 'Hlína',         walk: true,  cost: 1,    fert: 0.7 },
  { id: 'gravel',  name: 'Kamenitá zem',  walk: true,  cost: 1.05, fert: 0 },
];

// Předměty / suroviny
const ITEMS = {
  wood:  { name: 'Dřevo' },
  stone: { name: 'Kámen' },
  iron:  { name: 'Železné pláty' },
  food:  { name: 'Potraviny', desc: 'syrové – brambory a bobule' },
  meal:  { name: 'Jídlo', desc: 'uvařené pokrmy' },
  // nové suroviny přidávej na konec – pořadí určuje bity filtru skladu v uložených hrách
  plank: { name: 'Prkna' },
  ore:   { name: 'Železná ruda' },
};
const ITEM_ORDER = ['wood', 'plank', 'stone', 'ore', 'iron', 'food', 'meal'];
const ITEM_KEYS = Object.keys(ITEMS);
const ITEM_BIT = {};
ITEM_KEYS.forEach((k, n) => { ITEM_BIT[k] = 1 << n; });
const FILTER_CUSTOM = 0x8000;   // příznak „sklad má vlastní filtr“

const SEASONS = ['Jaro', 'Léto', 'Podzim', 'Zima'];

// Přírodní objekty
const OBJECTS = {
  tree: { name: 'Strom',          work: 110, blocks: false, cost: 1.7 },
  rock: { name: 'Skála',          work: 190, blocks: true },
  ore:  { name: 'Ložisko železné rudy', work: 230, blocks: true },
  bush: { name: 'Keř s bobulemi', work: 40,  blocks: false, cost: 1.3 },
};

// Stavby
const BUILD = {
  wall_wood:   { name: 'Dřevěná zeď',     layer: 'struct', cost: { wood: 5 },  work: 80,  blocks: true, wall: true, burns: true, mode: 'perimeter', hint: 'Táhni pro obdélník zdí (místnost) nebo rovnou čáru.' },
  wall_stone:  { name: 'Kamenná zeď',     layer: 'struct', cost: { stone: 5 }, work: 150, blocks: true, wall: true, mode: 'perimeter', hint: 'Pevná kamenná zeď. Táhni pro obdélník nebo čáru.' },
  door:        { name: 'Dveře',           layer: 'struct', cost: { wood: 6 },  work: 90,  door: true, burns: true, walkCost: 1.3, mode: 'single', hint: 'Klepni na místo ve zdi, kde mají být dveře.' },
  floor_wood:  { name: 'Dřevěná podlaha', layer: 'floor',  cost: { plank: 1 }, work: 30,  burns: true, mode: 'rect', hint: 'Táhni pro vyplnění plochy podlahou z prken. Po podlaze se chodí rychleji.' },
  floor_stone: { name: 'Kamenná dlažba',  layer: 'floor',  cost: { stone: 2 }, work: 45,  mode: 'rect', hint: 'Táhni pro vyplnění plochy dlažbou.' },
  bed:         { name: 'Postel',          layer: 'struct', cost: { wood: 15 }, work: 120, burns: true, walkCost: 1.4, mode: 'single', hint: 'Klepni pro umístění postele. Spánek v posteli zlepšuje náladu.' },
  table:       { name: 'Stůl',            layer: 'struct', cost: { wood: 12 }, work: 90,  blocks: true, burns: true, mode: 'single', hint: 'Jídlo u stolu (na židli vedle něj) zlepšuje náladu.' },
  chair:       { name: 'Židle',           layer: 'struct', cost: { wood: 5 },  work: 45,  burns: true, walkCost: 1.3, mode: 'single', hint: 'Postav ji těsně vedle stolu. Kolonisté si k jídlu sednou.' },
  chest:       { name: 'Truhla',          layer: 'struct', cost: { plank: 12 }, work: 100, burns: true, storage: true, walkCost: 1.5, mode: 'single', hint: 'Pojme 300 kusů jedné suroviny a potraviny se v ní kazí pomaleji. Klepnutím na ni nastavíš filtr.' },
  campfire:    { name: 'Ohniště',         layer: 'struct', cost: { wood: 10 }, work: 70,  blocks: true, light: 7, heat: 16, mode: 'single', hint: 'Na ohništi se vaří jídlo. V noci svítí a v uzavřené místnosti ji vytopí.' },
  lamp:        { name: 'Železná lampa',   layer: 'struct', cost: { iron: 2, plank: 2 }, work: 60, blocks: true, light: 6, mode: 'single', hint: 'Osvětluje okolí v noci.' },

  // ----- dílny obsluhované kolonistou -----
  saw:      { name: 'Pila',            layer: 'struct', cost: { wood: 25, stone: 5 }, work: 120, blocks: true, mode: 'single',
              machine: { manual: true, recipe: { in: { wood: 1 }, out: { plank: 1 }, work: 55 }, target: 40 },
              hint: 'Dílna: kolonista řeže dřevo na prkna (práce Řemeslo). Cílovou zásobu nastavíš klepnutím na pilu.' },
  furnace:  { name: 'Pec',             layer: 'struct', cost: { stone: 30 }, work: 150, blocks: true, light: 3, heat: 10, mode: 'single',
              machine: { manual: true, recipe: { in: { ore: 2, wood: 1 }, out: { iron: 1 }, work: 110 }, target: 30, pollute: 0.5 },
              hint: 'Dílna: taví 2 rudy na 1 železný plát, jako palivo spálí 1 dřevo.' },
  research: { name: 'Výzkumný stůl',   layer: 'struct', cost: { wood: 30, stone: 10 }, work: 140, blocks: true, burns: true, size: [2, 1], rot: true, mode: 'single',
              hint: 'Kolonista u něj bádá (práce Výzkum). Co zkoumat, vybereš ve Výroba → Výzkum.' },

  // ----- logistika a stroje -----
  belt:     { name: 'Dopravní pás',    layer: 'struct', cost: { iron: 1 }, work: 20, rot: true, mode: 'line', tech: 'belts',
              machine: { belt: true },
              hint: 'Posouvá hromádku na další políčko ve směru šipky. Táhni pro celou trasu, zatáčku vytvoříš navázáním dalšího směru.' },
  drill:    { name: 'Vrták',           layer: 'struct', cost: { iron: 12, plank: 8 }, work: 160, blocks: true, rot: true, mode: 'single', tech: 'drill', onOre: true,
              machine: { power: 12, drill: true, work: 45 },
              hint: 'Postav na ložisko rudy. S energií těží sám a rudu klade ve směru šipky (na pás, zem nebo do stroje).' },
  autosaw:  { name: 'Automatická pila', layer: 'struct', cost: { iron: 10, plank: 10 }, work: 160, blocks: true, rot: true, mode: 'single', tech: 'autosaw',
              machine: { power: 10, recipe: { in: { wood: 1 }, out: { plank: 1 }, work: 70 } },
              hint: 'Bere dřevo ze sousedních políček nebo z pásu a prkna klade ve směru šipky.' },
  autofurnace: { name: 'Pec s podavačem', layer: 'struct', cost: { iron: 16, stone: 20 }, work: 200, blocks: true, rot: true, light: 3, heat: 10, mode: 'single', tech: 'autofurnace',
              machine: { power: 15, recipe: { in: { ore: 2, wood: 1 }, out: { iron: 1 }, work: 140 }, pollute: 0.5 },
              hint: 'Sama si bere rudu a dřevo ze sousedních políček nebo z pásu, pláty klade ve směru šipky.' },

  // ----- energie -----
  pole:     { name: 'Sloup vedení',    layer: 'struct', cost: { wood: 4, iron: 1 }, work: 40, blocks: true, mode: 'single', tech: 'water',
              machine: { pole: true },
              hint: 'Propojuje zdroje energie a stroje na větší vzdálenost (dosah 7 políček).' },
  waterwheel: { name: 'Vodní kolo',    layer: 'struct', cost: { plank: 20, iron: 4 }, work: 200, blocks: true, mode: 'single', tech: 'water', onWater: true,
              machine: { gen: 'water', supply: 30 },
              hint: 'Postav na mělkou vodu. Dává stálou energii, v mrazu ale zamrzá.' },
  windmill: { name: 'Větrník',         layer: 'struct', cost: { plank: 30, iron: 8 }, work: 260, blocks: true, size: [2, 2], mode: 'single', tech: 'wind',
              machine: { gen: 'wind', supply: 55 },
              hint: 'Výkon závisí na síle větru – za bouřky nejvíc, za bezvětří skoro nic.' },
  boiler:   { name: 'Kotel na dřevo',  layer: 'struct', cost: { stone: 20, iron: 15 }, work: 260, blocks: true, size: [2, 2], light: 3, heat: 12, mode: 'single', tech: 'steam',
              machine: { gen: 'boiler', supply: 70, fuel: 'wood', burnMin: 45, pollute: 1 },
              hint: 'Spaluje dřevo ze sousedních políček nebo z pásu. Silný a spolehlivý zdroj, ale znečišťuje okolí.' },
};

// Směry: 0 východ, 1 jih, 2 západ, 3 sever
const DIRS4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Strom technologií. Dokončení všech je cílem hry.
const TECHS = {
  belts:       { name: 'Mechanika',         cost: 50,  req: [],                 desc: 'Dopravní pásy – suroviny se vozí samy.' },
  water:       { name: 'Vodní energie',     cost: 70,  req: [],                 desc: 'Vodní kolo a sloupy vedení.' },
  drill:       { name: 'Těžební stroje',    cost: 110, req: ['belts', 'water'], desc: 'Vrták těžící ložisko bez kolonistů.' },
  autosaw:     { name: 'Automatická pila',  cost: 90,  req: ['water'],          desc: 'Pila poháněná energií.' },
  wind:        { name: 'Větrná energie',    cost: 90,  req: ['water'],          desc: 'Větrník – energie i daleko od vody.' },
  steam:       { name: 'Parní síla',        cost: 140, req: ['water'],          desc: 'Kotel na dřevo – výkon za každého počasí.' },
  autofurnace: { name: 'Pec s podavačem',   cost: 170, req: ['drill'],          desc: 'Tavení rudy bez obsluhy.' },
  colony:      { name: 'Soběstačná kolonie', cost: 260, req: ['autosaw', 'wind', 'steam', 'autofurnace'], desc: 'Završení výzkumu – cíl hry.' },
};

// Pracovní typy (pořadí = pořadí při stejné prioritě)
const WORK_TYPES = [
  { id: 'cook',  name: 'Vaření',    short: 'Vař.',  skill: 'cook' },
  { id: 'build', name: 'Stavba',    short: 'Stav.', skill: 'build' },
  { id: 'grow',  name: 'Farmaření', short: 'Farm.', skill: 'grow' },
  { id: 'craft', name: 'Řemeslo',   short: 'Řem.',  skill: 'craft' },
  { id: 'chop',  name: 'Kácení',    short: 'Kác.',  skill: 'chop' },
  { id: 'mine',  name: 'Těžba',     short: 'Těž.',  skill: 'mine' },
  { id: 'research', name: 'Výzkum', short: 'Výz.',  skill: 'research' },
  { id: 'haul',  name: 'Nošení',    short: 'Noš.',  skill: null },
];
const SKILLS = { build: 'Stavba', chop: 'Dřevorubectví', mine: 'Těžba', grow: 'Farmaření', cook: 'Vaření', craft: 'Řemeslo', research: 'Výzkum' };

const TRAITS = [
  { id: 'optimist', name: 'Optimista',    desc: '+8 nálada', mood: 8 },
  { id: 'pessimist', name: 'Pesimista',   desc: '-8 nálada', mood: -8 },
  { id: 'hardwork', name: 'Pracant',      desc: '+20 % rychlost práce', work: 1.2 },
  { id: 'lazy',     name: 'Lenoch',       desc: '-15 % rychlost práce, +5 nálada', work: 0.85, mood: 5 },
  { id: 'fast',     name: 'Rychlonožka',  desc: '+20 % rychlost chůze', move: 1.2 },
  { id: 'glutton',  name: 'Jedlík',       desc: 'rychleji vyhladoví', hunger: 1.35 },
  { id: 'learner',  name: 'Bystrá hlava', desc: '+50 % učení dovedností', learn: 1.5 },
];

const NAMES = {
  m: { first: ['Jan', 'Petr', 'Tomáš', 'Marek', 'Jakub', 'Lukáš', 'Ondřej', 'Vojtěch', 'Matěj', 'Filip'],
       last: ['Novák', 'Dvořák', 'Svoboda', 'Černý', 'Procházka', 'Kučera', 'Veselý', 'Horák', 'Marek', 'Pokorný'] },
  f: { first: ['Eva', 'Lucie', 'Klára', 'Tereza', 'Anna', 'Kateřina', 'Barbora', 'Veronika', 'Zuzana', 'Markéta'],
       last: ['Nováková', 'Dvořáková', 'Svobodová', 'Černá', 'Procházková', 'Kučerová', 'Veselá', 'Horáková', 'Marková', 'Pokorná'] },
};
