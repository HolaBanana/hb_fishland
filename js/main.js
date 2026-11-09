'use strict';
/**
 * main – spuštění hry.
 */
window.addEventListener('DOMContentLoaded', () => {
  const loading = document.getElementById('loading');
  // necháme prohlížeč vykreslit obrazovku načítání, pak generujeme svět
  setTimeout(() => {
    const params = new URLSearchParams(location.search);
    const seed = params.has('seed') ? (parseInt(params.get('seed'), 10) || 1) : (Date.now() % 1000000000);
    Sprites.init();
    Game.init(seed);
    const cv = document.getElementById('game');
    Renderer.init(cv);
    Input.init(cv);
    UI.init();
    Game.start();
    loading.classList.add('hidden');
    if (!params.has('nohelp')) UI.openHelp(true);
    window.__ready = true;
  }, 30);
});
