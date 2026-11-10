# Kolonie – 2D budovatelská survival hra (HTML5 Canvas)

Hra ve stylu RimWorldu napsaná v čistém JavaScriptu bez herních enginů a knihoven.
Veškerá pixel-art grafika (terén, stromy, kolonisté, stavby, ikony) se generuje kódem.

## Spuštění

**Nejjednodušší:** stáhni jediný soubor `kolonie.html` a otevři ho v prohlížeči (dvojklik). Obsahuje celou hru včetně stylů a skriptů.
Po úpravách zdrojáků ho znovu sestavíš příkazem `python3 build.py`.

Vývojová verze: Stačí otevřít `index.html` v prohlížeči (funguje i z disku, `file://`), nebo spustit
libovolný statický server, např.:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Parametry URL: `?seed=123` (pevné semínko mapy), `?nohelp` (bez úvodní nápovědy).

## Funkce

- **Generovaná mapa** 120×120 (fraktální šum): jezera, písek, tráva, úrodná půda, hlína,
  hory se skálou a žilkami **železné rudy**, lesy (listnaté i jehličnaté) a keře s bobulemi.
- **4 kolonisté** s náhodnými českými jmény, vzhledem, povahovými rysy a dovednostmi
  (stavba, těžba, farmaření, vaření), které se prací zlepšují.
- **Potřeby**: sytost, energie, nálada (myšlenky typu „teplé jídlo“, „spal/a na zemi“,
  „moknutí v dešti“…). Při velmi špatné náladě hrozí psychické zhroucení.
- **Samostatná AI**: kolonisté si berou práci podle **priorit 1–4** (okno *Práce*) a vzdálenosti,
  rezervují si cíle, nosí materiál, staví, kácí, těží, sází, sklízí, vaří, nosí do skladu,
  jedí a spí. Cesty hledají algoritmem **A\*** (8 směrů, binární halda, ceny terénu).
- **Stavby**: dřevěné a kamenné zdi, dveře, podlahy, postele, ohniště (vaření, světlo), železné lampy,
  bourání s vrácením části materiálu.
- **Zóny**: sklad a pole s bramborami (růst závisí na úrodnosti, světle a dešti).
- **Den a noc** s dynamickým osvětlením (ohně a lampy), západy slunce,
  **počasí** (jasno, oblačno, déšť, bouřka s blesky, mlha) a stíny mraků.
- **Zrychlení času** ❚❚ / 1× / 2× / 3×.

## Ovládání

| Akce | Dotyk | Myš / klávesnice |
|---|---|---|
| Posun mapy | tažení jedním prstem (nástroj Výběr) nebo dvěma prsty | pravé/prostřední tlačítko, WASD / šipky |
| Zoom | roztažení dvou prstů | kolečko, `+` / `-` |
| Výběr oblasti | zvol nástroj ve spodním menu a táhni prstem | tažení levým tlačítkem |
| Výběr kolonisty / políčka | klepnutí | kliknutí |
| Pauza / rychlost | tlačítka vpravo nahoře | mezerník, `1` `2` `3` |
| Zrušit nástroj | ✕ u nápovědy nástroje | `Esc` |

## Struktura kódu

```
index.html          – kostra stránky a UI prvky
css/style.css       – vzhled rozhraní (pixel-art panely, mobilní rozvržení)
js/utils.js         – náhoda se semínkem, šum (value noise, fBm), barvy
js/config.js        – konstanty a definice terénu, předmětů, staveb, prací, rysů
js/world.js         – mapa, generování, předměty, zóny, plány staveb, růst rostlin
js/pathfinding.js   – A* hledání cesty
js/time.js          – herní čas, den/noc, počasí
js/jobs.js          – výběr práce podle priorit a průběh jednotlivých úkolů
js/colonist.js      – kolonista: potřeby, nálada, dovednosti, pohyb, rozhodování
js/sprites.js       – procedurální pixel-art grafika
js/camera.js        – kamera a zoom
js/tools.js         – nástroje hráče (označování, stavění, zóny)
js/input.js         – dotykové a myší ovládání
js/renderer.js      – vykreslování, osvětlení, počasí
js/ui.js            – horní lišta, karty kolonistů, info panel, menu, priority, notifikace
js/game.js          – stav hry, rezervace a herní smyčka s pevným krokem
js/main.js          – spuštění
```
