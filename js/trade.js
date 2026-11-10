'use strict';
/**
 * Trade – obchodník. Jednou za čas dorazí karavana a zůstane půl dne; v okně
 * obchodu jde měnit přebytky za suroviny, které na mapě chybí (výměnný obchod).
 */
const Trade = {
  next: 0,
  active: null,          // { until, stock: {surovina: počet} }
  SELL: 0.6,             // za kolik hodnoty karavana vykupuje
  BUY: 1.4,              // za kolik hodnoty prodává
  OFFER: { wood: 60, stone: 60, plank: 30, ore: 40, iron: 14, food: 40, meal: 14, meat: 10, wool: 12, leather: 12, coat: 2, bow: 1, ammo: 40 },

  reset() { this.active = null; this.next = TimeSys.minutes + 60 * 24 * U.range(3.5, 5); },
  hourly() {
    const now = TimeSys.minutes;
    if (this.active && now >= this.active.until) {
      this.active = null;
      UI.toast('Karavana odjela.', 'info');
      if (UI.ready) UI.closeTrade();
    }
    if (!this.active && now >= this.next) {
      if (TimeSys.hour >= 7 && TimeSys.hour <= 12) this.arrive();
      else this.next = now + 60;
    }
  },
  arrive() {
    const stock = {};
    for (const k in this.OFFER) {
      // čeho má kolonie málo, toho karavana veze víc
      const scarce = World.counts[k] < this.OFFER[k] * 0.5 ? 1.5 : 0.8;
      const n = Math.round(this.OFFER[k] * scarce * U.range(0.5, 1.3));
      if (n > 0 && U.chance(0.85)) stock[k] = n;
    }
    this.active = { until: TimeSys.minutes + 60 * 12, stock };
    this.next = TimeSys.minutes + 60 * 24 * U.range(5, 8);
    Game.alert('Dorazila obchodní karavana! Zůstane do večera – otevři Obchod (ikona vozíku nahoře).', 'good', World.start.x, World.start.y);
  },
  sellPrice(k) { return VALUE[k] * this.SELL; },
  buyPrice(k) { return VALUE[k] * this.BUY; },
  /** Co může kolonie nabídnout (volné, nerezervované kusy). */
  have(k) { return Math.max(0, World.counts[k] - Game.resType[k]); },
  value(sell, buy) {
    let s = 0, b = 0;
    for (const k in sell) s += sell[k] * this.sellPrice(k);
    for (const k in buy) b += buy[k] * this.buyPrice(k);
    return { sell: s, buy: b };
  },
  /** Provede výměnu. Vrací true při úspěchu. */
  deal(sell, buy) {
    if (!this.active) return false;
    const v = this.value(sell, buy);
    if (v.buy > v.sell + 0.001 || v.sell <= 0) return false;
    for (const k in sell) if (sell[k] > this.have(k)) return false;
    for (const k in buy) if (buy[k] > (this.active.stock[k] || 0)) return false;
    for (const k in sell) {
      World.removeItems(k, sell[k]);
      this.active.stock[k] = (this.active.stock[k] || 0) + sell[k];
    }
    const s = World.start;
    for (const k in buy) {
      if (!buy[k]) continue;
      this.active.stock[k] -= buy[k];
      World.dropItem(s.x, s.y + 1, k, buy[k]);
    }
    Game.stats.trades = (Game.stats.trades || 0) + 1;
    return true;
  },
  pack() { return { next: this.next, active: this.active }; },
  unpack(d) { if (d) { this.next = d.next; this.active = d.active || null; } else this.reset(); },
};
