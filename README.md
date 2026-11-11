# Kolonie – 2D budovatelská survival hra (HTML5 Canvas)

Hra ve stylu RimWorldu a Factoria napsaná v čistém JavaScriptu bez herních enginů a knihoven.
Kolonisté jsou na začátku ruční práce, stroje je postupně nahrazují. Veškerá pixel-art grafika
(terén, stromy, kolonisté, stavby, stroje, ikony) se generuje kódem.

## Spuštění

**Nejjednodušší:** stáhni jediný soubor `kolonie.html` a otevři ho v prohlížeči (dvojklik).
Obsahuje celou hru včetně stylů, skriptů i písma – nemá žádnou vnější závislost a funguje offline.
Po úpravách zdrojáků ho znovu sestavíš příkazem `python3 build.py`.

Vývojová verze: otevři `index.html` v prohlížeči (funguje i z disku, `file://`), nebo spusť
libovolný statický server:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Parametr URL `?seed=123` spustí rovnou novou hru s výchozím nastavením a daným semínkem
(bez nabídky pokračování a okna nové hry) – hodí se pro vývoj a testy.

### Nasazení na GitHub Pages

Workflow `.github/workflows/pages.yml` při změně v `js/`, `css/`, `fonts/`, `index.html` nebo
`build.py` na větvi `main` spustí `build.py` a nasadí výsledek jako stránku. Jednorázově je potřeba
v repozitáři zapnout **Settings → Pages → Source: GitHub Actions**. Jde spustit i ručně
(Actions → Nasazení na GitHub Pages → Run workflow).

## Funkce

### Svět a kolonisté
- **Generovaná mapa** 120×120 (fraktální šum): jezera, písek, tráva, úrodná půda, hory se skálou
  a **ložisky železné rudy** (každé políčko má zásobu 200 kusů), lesy a keře s bobulemi.
- **Kolonisté** s českými jmény, vzhledem, povahovými rysy a dovednostmi (stavba, dřevorubectví,
  těžba, farmaření, vaření, řemeslo, výzkum), které se prací zlepšují.
- **Potřeby**: zdraví, sytost, energie, nálada (myšlenky jako „teplé jídlo“, „vlastní ložnice“,
  „mrzne“…). Při špatné náladě hrozí psychické zhroucení, dlouhé hladovění a vyčerpání zabíjí.
  Když zemřou všichni, hra končí shrnutím.
- **Samostatná AI**: kolonisté si berou práci podle **priorit 1–4** (okno *Práce*) a vzdálenosti,
  rezervují si cíle, hledají cestu algoritmem **A\***. Materiál na stavby nabírají pro víc
  sousedních plánů najednou.

### Přežití
- **Roční období** po 4 dnech s teplotou a sněhem. V zimě plodiny nerostou a keře neplodí.
- **Kažení potravin**: syrové se kazí rychleji než uvařené; pod střechou, v truhle a v chladu pomaleji.
- **Místnosti a střecha**: prostor uzavřený zdmi a dveřmi je zastřešený – neprší v něm a drží
  teplo z ohniště. Vlastní ložnice zlepšuje náladu.
- **Události**: příchod poutníků, nájezdy divočáků na pole, požáry po zásahu bleskem, které se
  šíří po stromech a dřevěných stavbách a kolonisté je hasí.
- **Stavby a nábytek**: zdi, dveře, podlahy, postele, ohniště, lampy, stůl a židle (jídlo u stolu),
  truhla; sklad i truhla mají filtr druhů surovin.

### Automatizace
- **Dílny** obsluhované kolonisty: pila (dřevo → prkna), pec (ruda + dřevo jako palivo → železné pláty)
  s nastavitelnou cílovou zásobou. Pokročilé stavby vyžadují zpracované materiály.
- **Dopravní pásy** se směrem; zatáčky vznikají navázáním směrů.
- **Stroje**: vrták na ložisku, automatická pila, pec s podavačem. Berou vstup ze sousedních políček
  nebo z pásu a výstup kladou ve směru otočení.
- **Energie**: vodní kolo (na mělké vodě, v mrazu zamrzá), větrník (podle síly větru), kotel na dřevo.
  Sítě se propojují dosahem a sloupy vedení; při nedostatku energie stroje zpomalí, bez ní stojí.
  Přehled výroby a spotřeby je ve *Výroba → Energie*.
- **Výzkum**: výzkumný stůl a strom technologií odemykající stroje. Dokončení stromu je cíl hry.

### Rozšířený svět
- **Zvířata**: jeleni a divočáci na mapě, **lov** (práce a dovednost Lov), chov slepic a ovcí
  u kurníku a ovčína na zóně **Pastvina**. Suroviny maso, vejce, vlna, kůže.
- **Oblečení a tělesné teplo**: krejčovský stůl šije teplé oblečení z vlny nebo kůže. V zimě bez
  oblečení a mimo vytopenou místnost kolonista prochladne (nálada, pak zdraví).
- **Obchodník**: jednou za čas přijede karavana; výměnný obchod přebytků za chybějící suroviny.
- **Nájezdy a obrana**: nájezdy sílí s bohatstvím kolonie, kuše ze zbrojnice, hradby a brány,
  automatické střílny zásobované municí z pásu. Mírumilovný režim nájezdy vypne.
- **Znečištění** z pecí a kotlů se šíří okolím, snižuje náladu a zpomaluje plodiny; přepínatelná vrstva.
- **Údržba strojů**: opotřebení, porucha a oprava kolonistou (práce Údržba, 1 železný plát).
- **Logistika navíc**: rozdělovač, třídič s filtrem suroviny, podzemní pás, koleje s vozíkem.
- **Vztahy**: přátelství a nevraživost podle povah, společného času a jídla; vliv na náladu.
- **Přehledy**: minimapa s klepnutím pro skok kamery, graf zásob v čase, seznam upozornění s přesunem kamery.
- **Zvuk** generovaný přes Web Audio (sekera, krumpáč, kladivo, déšť, hrom, stroje, upozornění);
  hlasitost a vypnutí v Menu, spustí se po prvním dotyku.
- **Nastavení nové hry**: velikost mapy, voda, hory, lesy, obtížnost, mírumilovný režim, vlastní semínko,
  výběr a přelosování startovních kolonistů.
- **Tutoriál jako úkoly** s odměnou (kácení, postel, pole, dílny, výzkum, energie, první vrták); jde přeskočit.

### Ostatní
- **Den a noc** s dynamickým osvětlením, **počasí** (jasno, oblačno, déšť/sněžení, bouřka, mlha).
- **Rychlost času** ❚❚ / 1× / 2× / 3× / 4× a volitelné zrychlení, když všichni spí.
- **Ukládání**: automaticky do `localStorage` každou herní hodinu, při startu nabídka pokračování,
  v Menu export a import do souboru JSON. Ukládá se semínko mapy a jen změny světa.

## Ovládání

| Akce | Dotyk | Myš / klávesnice |
|---|---|---|
| Posun mapy | tažení jedním prstem (nástroj Výběr) nebo dvěma prsty | pravé/prostřední tlačítko, WASD / šipky |
| Zoom | roztažení dvou prstů | kolečko, `+` / `-` |
| Výběr oblasti | zvol nástroj ve spodním menu a táhni prstem | tažení levým tlačítkem |
| Potvrdit / zrušit výběr | tlačítka ✔ Potvrdit / ✕ Zrušit | myší se provede hned; `Enter` / `Esc` |
| Vrátit poslední akci | tlačítko ↶ Zpět | `Ctrl+Z` |
| Otočit stavbu | tlačítko ⟳ v nápovědě nástroje | `R` |
| Pás | táhni ve směru, kterým má vozit | totéž |
| Výběr kolonisty / zvířete / políčka / stroje | klepnutí | kliknutí |
| Minimapa, graf zásob, upozornění | tlačítko Přehled (a minimapa vpravo dole) | totéž |
| Filtr skladu, cíl dílny | klepni na sklad, truhlu nebo dílnu | totéž |
| Pauza / rychlost | tlačítka vpravo nahoře | mezerník, `1`–`4` |
| Zrušit nástroj | ✕ u nápovědy nástroje | `Esc` |

## Struktura kódu

```
index.html          – kostra stránky a UI prvky
build.py            – sestaví vše do jednoho souboru kolonie.html
css/style.css       – vzhled rozhraní (pixel-art panely, mobilní rozvržení)
fonts/              – písmo VT323 (SIL OFL)
js/utils.js         – náhoda se semínkem, šum (value noise, fBm), barvy
js/config.js        – konstanty a definice terénu, surovin, staveb, strojů, technologií, prací
js/world.js         – mapa, generování, předměty, zóny, plány staveb, místnosti, růst a kažení
js/pathfinding.js   – A* hledání cesty
js/time.js          – herní čas, den/noc, roční období, teplota, počasí
js/fire.js          – požáry
js/machines.js      – stav a tick staveb: dílny, stroje, dopravní pásy
js/power.js         – energetické sítě
js/research.js      – strom technologií
js/pollution.js     – znečištění
js/trade.js         – obchodní karavana
js/combat.js        – nájezdy, obrana, střílny
js/carts.js         – koleje a vozíky
js/social.js        – vztahy mezi kolonisty
js/sound.js         – zvukové efekty (Web Audio)
js/quests.js        – tutoriál jako úkoly
js/jobs.js          – výběr práce podle priorit a průběh jednotlivých úkolů
js/colonist.js      – kolonista: potřeby, zdraví, nálada, dovednosti, pohyb, rozhodování
js/animals.js       – zvěř a hospodářská zvířata
js/events.js        – náhodné události (poutníci, nájezdy zvěře)
js/sprites.js       – procedurální pixel-art grafika
js/camera.js        – kamera a zoom
js/tools.js         – nástroje hráče (označování, stavění, zóny, Zpět)
js/input.js         – dotykové a myší ovládání
js/renderer.js      – vykreslování, osvětlení, počasí
js/ui.js            – horní lišta, karty kolonistů, info panel, menu, priority, výzkum, energie
js/save.js          – ukládání: localStorage, export a import do souboru
js/game.js          – stav hry, rezervace a herní smyčka s pevným krokem
js/main.js          – spuštění, nabídka pokračování z uložené hry
```
