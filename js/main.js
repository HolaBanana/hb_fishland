'use strict';
/**
 * main – spuštění hry: nabídka pokračování z uložené pozice, nebo nová kolonie.
 */
const Main = {
  started: false,

  /** Spustí novou hru (data = null) nebo načte uloženou. Funguje i za běhu. */
  boot(data, seed) {
    const loading = document.getElementById('loading');
    loading.classList.remove('hidden');
    document.getElementById('modal').classList.add('hidden');
    // necháme prohlížeč vykreslit obrazovku načítání, pak generujeme svět
    setTimeout(() => {
      if (data) Game.load(data);
      else Game.newGame(seed !== undefined ? seed : (Date.now() % 1000000000));
      if (!this.started) {
        this.started = true;
        const cv = document.getElementById('game');
        Renderer.init(cv);
        Input.init(cv);
        UI.init();
        Game.start();
        // uložit i při odchodu ze stránky / přepnutí aplikace na telefonu
        document.addEventListener('visibilitychange', () => { if (document.hidden) Save.store(); });
        window.addEventListener('pagehide', () => Save.store());
      }
      loading.classList.add('hidden');
      if (data) UI.toast(`Hra načtena – ${data.label}.`, 'good');
      else if (!this.params.has('nohelp')) UI.openHelp(true);
      window.__ready = true;
    }, 30);
  },
};

window.addEventListener('DOMContentLoaded', () => {
  const params = Main.params = new URLSearchParams(location.search);
  try { Game.autoFast = localStorage.getItem('kolonie.autoFast') === '1'; } catch (e) { /* bez úložiště */ }
  // písmo se používá i na plátně – vyžádat si ho hned
  if (document.fonts && document.fonts.load) document.fonts.load('16px VT323').catch(() => {});
  Sprites.init();
  if (params.has('seed')) { Main.boot(null, parseInt(params.get('seed'), 10) || 1); return; }
  const saved = Save.peek();
  if (saved) {
    document.getElementById('loading').classList.add('hidden');
    UI.askContinue(saved);
  } else Main.boot(null);
});
