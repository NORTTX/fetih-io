// Bot yapay zekası: erken oyunda boş araziye yayıl, sonra zayıf komşulara saldır
const Bots = {
  tick() {
    for (let id = 1; id < Game.players.length; id++) {
      const p = Game.players[id];
      if (!p.isBot || !p.alive || p.pixels === 0) continue;
      if ((Game.tick + id * 3) % CFG.BOT_DECIDE_TICKS !== 0) continue;
      this.decide(p);
    }
  },

  decide(p) {
    if (p.attacks.size >= 2) return; // zaten meşgul

    const nb = this.sampleNeighbors(p);
    const fullB = CFG.FULL_INCOME_MULT * p.pixels;

    this.diplomacy(p, nb);
    if (Game.cycle >= 20 && Math.random() < 0.12) this.tryBuild(p, nb);

    // Gemi: karada yayılacak yer kalmadıysa denizaşırı hedef ara
    if (!nb.hasNeutral) {
      let myBoats = 0;
      for (const b of Game.boats) if (b.from === p.id) myBoats++;
      const isolated = nb.enemies.size === 0;
      if (myBoats === 0 && (isolated || (p.balance > fullB * 0.5 && Math.random() < 0.25))) {
        const t = this.findSeaTarget(p);
        if (t >= 0) {
          Game.launchBoat(p.id, t, p.balance * (isolated ? 0.6 : 0.3));
          return;
        }
      }
    }

    // Erken oyun: boş arazi varsa agresif yayıl
    if (nb.hasNeutral) {
      if (Game.cycle < 12) {
        Game.launchAttack(p.id, 0, p.balance * 0.5);
        return;
      }
      // sonrasında: güç biriktikçe araziyi büyütmeye devam et
      if (p.balance > p.pixels * (7 / p.aggr)) {
        Game.launchAttack(p.id, 0, p.balance * 0.4);
        return;
      }
    }

    // Düşman komşular: en zayıfı seç
    let best = null, bestScore = Infinity;
    for (const tid of nb.enemies) {
      const t = Game.players[tid];
      const s = t.balance + t.pixels * 0.5;
      if (s < bestScore) { bestScore = s; best = t; }
    }
    if (!best) return;

    const ratio = p.balance / Math.max(1, best.balance);
    if (best.balance < best.pixels * 0.5) {
      // savunmasız hedef — fırsatçı saldırı
      Game.launchAttack(p.id, best.id, p.balance * 0.3);
    } else if (ratio > 2.2 / p.aggr && p.balance > fullB * 0.3) {
      Game.launchAttack(p.id, best.id, p.balance * 0.35);
    }
  },

  onOffer: null, // main.js bağlar: bot insana barış teklif edince çağrılır

  // İnşaat: savaştaysa sınıra kule, bolluktaysa şehir, kıyısı varsa liman
  tryBuild(p, nb) {
    const rich = (type, mult) => p.balance > Game.buildCost(p.id, type) * mult;
    if (nb.enemies.size > 0 && rich('tower', 2.5)) {
      let k = (Math.random() * p.border.size) | 0;
      for (const bi of p.border) { if (k-- <= 0) { Game.build(p.id, bi, 'tower'); return; } }
    }
    if (rich('city', 3)) {
      const idx = this.randomOwnedCell(p);
      if (idx >= 0) { Game.build(p.id, idx, 'city'); return; }
    }
    if (rich('port', 2.5) && Math.random() < 0.5) {
      for (const bi of p.border) {
        if (Game.nearWater(bi, 2)) { Game.build(p.id, bi, 'port'); return; }
      }
    }
  },

  randomOwnedCell(p) {
    const { owner } = Game;
    const N = Game.W * Game.H;
    for (let t = 0; t < 200; t++) {
      const i = (Math.random() * N) | 0;
      if (owner[i] === p.id) return i;
    }
    return -1;
  },

  diplomacy(p, nb) {
    if (Game.cycle < 12) return; // erken oyunda diplomasi yok

    // Güçlü insana komşuysak barış teklif et
    const h = Game.players[Game.humanId];
    if (nb.enemies.has(Game.humanId) && h && h.pixels > 0 &&
        !Game.hasPact(p.id, Game.humanId) && !Game.isTraitor(Game.humanId) &&
        h.balance > p.balance * 1.4 &&
        (p.lastOffer === undefined || Game.cycle - p.lastOffer > 30) &&
        Math.random() < 0.3) {
      p.lastOffer = Game.cycle;
      if (this.onOffer) this.onOffer(p.id);
    }

    // Çok cepheli savaştaysak en güçlü bot komşusuyla kendiliğinden pakt
    if (nb.enemies.size >= 2 && Math.random() < 0.1) {
      let strongest = null;
      for (const tid of nb.enemies) {
        if (tid === Game.humanId) continue;
        const t = Game.players[tid];
        if (!strongest || t.balance > strongest.balance) strongest = t;
      }
      if (strongest && !Game.isTraitor(strongest.id) && !Game.hasPact(p.id, strongest.id)) {
        Game.makePact(p.id, strongest.id);
      }
    }

    // İhanet: pakt ortağından ezici derecede güçlüysek küçük ihtimalle boz
    if (Math.random() < 0.04 * p.aggr) {
      for (const k of Game.pacts.keys()) {
        const [a, b] = k.split(':').map(Number);
        if (a !== p.id && b !== p.id) continue;
        const other = a === p.id ? b : a;
        const t = Game.players[other];
        if (t && p.balance > t.balance * 3.5) { Game.breakPact(p.id, other); break; }
      }
    }
  },

  // Denizaşırı hedef: önce boş kıyı (ada), yoksa çok zayıf düşman kıyısı
  findSeaTarget(p) {
    const { owner, terrain, W, H } = Game;
    const N = W * H;
    let weakCell = -1;
    for (let t = 0; t < 400; t++) {
      const i = (Math.random() * N) | 0;
      if (terrain[i] !== 1) continue;
      const oo = owner[i];
      if (oo === p.id || (oo > 0 && Game.players[oo].team === p.team)) continue;
      const x = i % W, y = (i / W) | 0;
      const coastal =
        (x > 0 && terrain[i - 1] === 0) || (x < W - 1 && terrain[i + 1] === 0) ||
        (y > 0 && terrain[i - W] === 0) || (y < H - 1 && terrain[i + W] === 0);
      if (!coastal) continue;
      const o = owner[i];
      if (o === 0) return i; // boş kıyı bulundu
      if (weakCell < 0 && Game.players[o].balance < p.balance * 0.4) weakCell = i;
    }
    return weakCell;
  },

  sampleNeighbors(p) {
    const { owner, terrain, W, H } = Game;
    const enemies = new Set();
    let hasNeutral = false;
    let count = 0;
    for (const bi of p.border) {
      if (++count > 120) break;
      const x = bi % W, y = (bi / W) | 0;
      let n;
      if (x > 0) { n = bi - 1; if (terrain[n] === 1) { const o = owner[n]; if (o === 0) hasNeutral = true; else if (o !== p.id && Game.players[o].team !== p.team && !Game.hasPact(p.id, o)) enemies.add(o); } }
      if (x < W - 1) { n = bi + 1; if (terrain[n] === 1) { const o = owner[n]; if (o === 0) hasNeutral = true; else if (o !== p.id && Game.players[o].team !== p.team && !Game.hasPact(p.id, o)) enemies.add(o); } }
      if (y > 0) { n = bi - W; if (terrain[n] === 1) { const o = owner[n]; if (o === 0) hasNeutral = true; else if (o !== p.id && Game.players[o].team !== p.team && !Game.hasPact(p.id, o)) enemies.add(o); } }
      if (y < H - 1) { n = bi + W; if (terrain[n] === 1) { const o = owner[n]; if (o === 0) hasNeutral = true; else if (o !== p.id && Game.players[o].team !== p.team && !Game.hasPact(p.id, o)) enemies.add(o); } }
    }
    return { hasNeutral, enemies };
  },
};
