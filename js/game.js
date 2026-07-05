// Oyun durumu ve çekirdek mantık: sahiplik, ekonomi, saldırı/yayılma, gemiler
const Game = {
  W: 0, H: 0,
  terrain: null, spawnable: null, owner: null,
  players: [null],           // id ile erişim, 0 = tarafsız
  boats: [],
  dirty: new Set(),          // yeniden boyanacak pikseller
  tick: 0, cycle: 0, rate: CFG.INTEREST_START,
  humanId: 1,
  spawnableCount: 0, landCount: 0,

  // Deterministik RNG (mulberry32): online modda tüm istemciler aynı tohumla
  // birebir aynı simülasyonu üretir — Math.random oyun mantığında YASAK
  setSeed(seed) {
    this._rngState = seed >>> 0;
  },
  rng() {
    let t = (this._rngState += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },

  init(map, seed) {
    this.setSeed(seed === undefined ? (Date.now() & 0xffffffff) : seed);
    this.W = CFG.MAP_W; this.H = CFG.MAP_H;
    this.terrain = map.terrain;
    this.spawnable = map.spawnable;
    this.spawnableCount = map.spawnableCount;
    this.landCount = map.landCount;
    this.owner = new Int16Array(this.W * this.H);
    this.players = [null];
    this.boats = [];
    this.dirty.clear();
    this.tick = 0; this.cycle = 0; this.rate = CFG.INTEREST_START;
    this._parent = new Int32Array(this.W * this.H); // deniz rotası BFS için
    this._q = new Int32Array(this.W * this.H);
    this._boatSeq = 0;
    this.pacts = new Map(); // "küçükId:büyükId" -> true (saldırmazlık paktı)
    this.buildings = [];    // {id, type, idx, owner}
    this.bMap = new Map();  // hücre -> bina (fetihte el değiştirme için)
  },

  // ---- Binalar ----

  buildCost(pid, type) {
    const def = CFG.BUILDINGS[type];
    return def.cost * Math.pow(def.mult, this.players[pid].bCount[type]);
  },

  build(fromId, idx, type) {
    const def = CFG.BUILDINGS[type];
    if (!def) return 'bad';
    const p = this.players[fromId];
    if (this.owner[idx] !== fromId) return 'notown';
    if (type === 'port' && !this.nearWater(idx, 2)) return 'coast';
    const { W } = this;
    const x = idx % W, y = (idx / W) | 0;
    for (const b of this.buildings) {
      const bx = b.idx % W, by = (b.idx / W) | 0;
      const d = (bx - x) * (bx - x) + (by - y) * (by - y);
      if (d < CFG.BUILD_MIN_DIST * CFG.BUILD_MIN_DIST) return 'near';
    }
    const cost = this.buildCost(fromId, type);
    if (p.balance < cost) return 'cash';
    p.balance -= cost;
    const bld = { id: this._boatSeq++, type, idx, owner: fromId };
    this.buildings.push(bld);
    this.bMap.set(idx, bld);
    p.bCount[type]++;
    return 'ok';
  },

  nearWater(idx, r) {
    const { W, H, terrain } = this;
    const x = idx % W, y = (idx / W) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (terrain[ny * W + nx] === 0) return true;
      }
    }
    return false;
  },

  // Savunanın kulesi bu pikseli koruyor mu?
  towerProtects(defId, pi) {
    const def = this.players[defId];
    if (!def || def.bCount.tower === 0) return false;
    const { W } = this;
    const x = pi % W, y = (pi / W) | 0;
    const r2 = CFG.BUILDINGS.tower.radius * CFG.BUILDINGS.tower.radius;
    for (const b of this.buildings) {
      if (b.type !== 'tower' || b.owner !== defId) continue;
      const bx = b.idx % W, by = (b.idx / W) | 0;
      if ((bx - x) * (bx - x) + (by - y) * (by - y) <= r2) return true;
    }
    return false;
  },

  // ---- Diplomasi ----

  pactKey(a, b) { return a < b ? a + ':' + b : b + ':' + a; },
  hasPact(a, b) { return this.pacts.has(this.pactKey(a, b)); },
  makePact(a, b) { this.pacts.set(this.pactKey(a, b), true); },
  isTraitor(id) { return this.players[id].traitorUntil > this.cycle; },

  breakPact(byId, otherId) {
    const k = this.pactKey(byId, otherId);
    if (!this.pacts.has(k)) return false;
    this.pacts.delete(k);
    this.players[byId].traitorUntil = this.cycle + CFG.TRAITOR_CYCLES; // hain damgası
    if (this.onPactBroken) this.onPactBroken(byId, otherId);
    return true;
  },

  addPlayer(name, color, isBot) {
    const id = this.players.length;
    const dark = darkenRGB(color, 0.62);
    const p = {
      id, name, isBot,
      color,
      col32: packRGB(color.r, color.g, color.b),
      dark32: packRGB(dark.r, dark.g, dark.b),
      cssColor: `rgb(${color.r},${color.g},${color.b})`,
      balance: CFG.START_BALANCE,
      lastIncome: 0,
      team: id, // FFA'da herkes kendi takımı; takım modunda üstüne yazılır
      traitorUntil: 0,
      bCount: { city: 0, tower: 0, port: 0 },
      pixels: 0, sumX: 0, sumY: 0,
      border: new Set(),
      attacks: new Map(),   // anahtar -> saldırı (kara: hedef id, deniz: özel anahtar)
      alive: true,
      aggr: 0.8 + this.rng() * 0.8,
    };
    this.players.push(p);
    return p;
  },

  spawn(p, cx, cy) {
    const { W, H, owner, terrain } = this;
    const r = CFG.SPAWN_RADIUS, r2 = r * r;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * W + x;
        if (terrain[i] === 1 && owner[i] === 0) this.setOwner(i, p.id);
      }
    }
  },

  setOwner(i, nid) {
    const { W, owner, players } = this;
    const old = owner[i];
    if (old === nid) return;
    const x = i % W, y = (i / W) | 0;
    if (old > 0) {
      const p = players[old];
      p.pixels--; p.sumX -= x; p.sumY -= y;
      p.border.delete(i);
    }
    owner[i] = nid;
    if (nid > 0) {
      const p = players[nid];
      p.pixels++; p.sumX += x; p.sumY += y;
      const bld = this.bMap.get(i);
      if (bld && bld.owner !== nid) { // bina el değiştirir
        const prev = bld.owner;
        if (prev > 0) players[prev].bCount[bld.type]--;
        bld.owner = nid;
        p.bCount[bld.type]++;
        if (this.onBuildingCaptured) this.onBuildingCaptured(bld, nid, prev);
      }
    }
    this.updateBorder(i); this.dirty.add(i);
    if (x > 0) { this.updateBorder(i - 1); this.dirty.add(i - 1); }
    if (x < W - 1) { this.updateBorder(i + 1); this.dirty.add(i + 1); }
    if (y > 0) { this.updateBorder(i - W); this.dirty.add(i - W); }
    if (y < this.H - 1) { this.updateBorder(i + W); this.dirty.add(i + W); }
  },

  updateBorder(i) {
    const o = this.owner[i];
    if (o <= 0) return;
    const { W, H, owner } = this;
    const x = i % W, y = (i / W) | 0;
    const b = x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
      owner[i - 1] !== o || owner[i + 1] !== o ||
      owner[i - W] !== o || owner[i + W] !== o;
    const p = this.players[o];
    if (b) p.border.add(i); else p.border.delete(i);
  },

  hasNeighborOwner(i, id) {
    const { W, H, owner } = this;
    const x = i % W, y = (i / W) | 0;
    return (x > 0 && owner[i - 1] === id) ||
           (x < W - 1 && owner[i + 1] === id) ||
           (y > 0 && owner[i - W] === id) ||
           (y < H - 1 && owner[i + W] === id);
  },

  // ---- Kara saldırısı ----
  // dirIdx verilirse saldırı o hücreye DOĞRU yoğunlaşır (yönlü ordu emri)

  allied(aId, bId) {
    if (aId <= 0 || bId <= 0) return false;
    return this.players[aId].team === this.players[bId].team;
  },

  launchAttack(fromId, targetId, amount, dirIdx) {
    const p = this.players[fromId];
    if (targetId > 0 && this.allied(fromId, targetId)) return false; // müttefik
    if (targetId > 0 && this.hasPact(fromId, targetId)) return false; // pakt var
    amount = Math.min(amount, p.balance);
    if (amount < 10) return false;
    const eff = amount * (1 - CFG.ATTACK_TAX);
    let att = p.attacks.get(targetId);
    if (att) {
      p.balance -= amount;
      att.troops += eff;
      if (dirIdx !== undefined) att.dir = dirIdx;
      this.refreshFrontier(att);
      return true;
    }
    att = {
      key: targetId, from: fromId, target: targetId, troops: eff,
      frontier: [], fset: new Set(), carry: 0, sea: false,
      dir: dirIdx !== undefined ? dirIdx : -1,
    };
    this.refreshFrontier(att);
    if (att.frontier.length === 0) return false; // sınır yok
    p.balance -= amount;
    p.attacks.set(targetId, att);
    return true;
  },

  refreshFrontier(att) {
    const { owner, terrain, W, H } = this;
    const p = this.players[att.from];
    const t = att.target;
    for (const bi of p.border) {
      const x = bi % W, y = (bi / W) | 0;
      let n;
      if (x > 0) { n = bi - 1; if (terrain[n] === 1 && owner[n] === t && !att.fset.has(n)) { att.fset.add(n); att.frontier.push(n); } }
      if (x < W - 1) { n = bi + 1; if (terrain[n] === 1 && owner[n] === t && !att.fset.has(n)) { att.fset.add(n); att.frontier.push(n); } }
      if (y > 0) { n = bi - W; if (terrain[n] === 1 && owner[n] === t && !att.fset.has(n)) { att.fset.add(n); att.frontier.push(n); } }
      if (y < H - 1) { n = bi + W; if (terrain[n] === 1 && owner[n] === t && !att.fset.has(n)) { att.fset.add(n); att.frontier.push(n); } }
    }
  },

  popFrontier(att) {
    const { owner, W } = this;
    const directed = att.dir >= 0;
    const dx0 = directed ? att.dir % W : 0;
    const dy0 = directed ? (att.dir / W) | 0 : 0;
    while (att.frontier.length > 0) {
      let k;
      if (directed) {
        // rastgele adaylar arasından hedefe en yakın cephe pikselini seç
        // → saldırı hedefe doğru koridor açarak ilerler
        const L = att.frontier.length;
        const tries = Math.min(12, L);
        let bestD = Infinity; k = 0;
        for (let t = 0; t < tries; t++) {
          const c = (this.rng() * L) | 0;
          const pi = att.frontier[c];
          const x = pi % W, y = (pi / W) | 0;
          const d = (x - dx0) * (x - dx0) + (y - dy0) * (y - dy0);
          if (d < bestD) { bestD = d; k = c; }
        }
      } else {
        k = (this.rng() * att.frontier.length) | 0;
      }
      const pi = att.frontier[k];
      att.frontier[k] = att.frontier[att.frontier.length - 1];
      att.frontier.pop();
      att.fset.delete(pi);
      if (owner[pi] !== att.target) continue;           // başkası almış
      if (!this.hasNeighborOwner(pi, att.from)) continue; // artık bitişik değil
      return pi;
    }
    return -1;
  },

  // ---- Gemiler ----

  // Tıklanan noktaya coğrafi olarak en yakın kıyı hücresini bul
  // (sahibi kim olursa olsun — gemi işaretlenen karaya gider, çıkarmada
  // kıyının o anki sahibi neyse ona karşı savaşılır)
  findCoast(idx) {
    const { W, H, terrain } = this;
    if (terrain[idx] !== 1) return -1;
    const q = this._q;
    const par = this._parent;
    par.fill(-2);
    let head = 0, tail = 0;
    q[tail++] = idx; par[idx] = -1;
    while (head < tail) {
      const i = q[head++];
      const x = i % W, y = (i / W) | 0;
      if ((x > 0 && terrain[i - 1] === 0) || (x < W - 1 && terrain[i + 1] === 0) ||
          (y > 0 && terrain[i - W] === 0) || (y < H - 1 && terrain[i + W] === 0)) return i;
      let n;
      if (x > 0) { n = i - 1; if (terrain[n] === 1 && par[n] === -2) { par[n] = i; q[tail++] = n; } }
      if (x < W - 1) { n = i + 1; if (terrain[n] === 1 && par[n] === -2) { par[n] = i; q[tail++] = n; } }
      if (y > 0) { n = i - W; if (terrain[n] === 1 && par[n] === -2) { par[n] = i; q[tail++] = n; } }
      if (y < H - 1) { n = i + W; if (terrain[n] === 1 && par[n] === -2) { par[n] = i; q[tail++] = n; } }
    }
    return -1;
  },

  // Hedef kıyıdan saldıranın kıyısına su üzerinden BFS → rota (saldıran → hedef sırasında)
  findSeaRoute(fromId, coastIdx) {
    const { W, H, owner, terrain } = this;
    const par = this._parent, q = this._q;
    par.fill(-2);
    let head = 0, tail = 0;
    const cx = coastIdx % W, cy = (coastIdx / W) | 0;
    const seed = [];
    if (cx > 0 && terrain[coastIdx - 1] === 0) seed.push(coastIdx - 1);
    if (cx < W - 1 && terrain[coastIdx + 1] === 0) seed.push(coastIdx + 1);
    if (cy > 0 && terrain[coastIdx - W] === 0) seed.push(coastIdx - W);
    if (cy < H - 1 && terrain[coastIdx + W] === 0) seed.push(coastIdx + W);
    for (const s of seed) { par[s] = -1; q[tail++] = s; }
    while (head < tail) {
      const i = q[head++];
      const x = i % W, y = (i / W) | 0;
      // saldıranın karasına değdik mi?
      if ((x > 0 && terrain[i - 1] === 1 && owner[i - 1] === fromId) ||
          (x < W - 1 && terrain[i + 1] === 1 && owner[i + 1] === fromId) ||
          (y > 0 && terrain[i - W] === 1 && owner[i - W] === fromId) ||
          (y < H - 1 && terrain[i + W] === 1 && owner[i + W] === fromId)) {
        const path = [];
        let c = i;
        while (c !== -1) { path.push(c); c = par[c]; }
        return path; // saldıran kıyısı → hedef kıyısı
      }
      let n;
      if (x > 0) { n = i - 1; if (terrain[n] === 0 && par[n] === -2) { par[n] = i; q[tail++] = n; } }
      if (x < W - 1) { n = i + 1; if (terrain[n] === 0 && par[n] === -2) { par[n] = i; q[tail++] = n; } }
      if (y > 0) { n = i - W; if (terrain[n] === 0 && par[n] === -2) { par[n] = i; q[tail++] = n; } }
      if (y < H - 1) { n = i + W; if (terrain[n] === 0 && par[n] === -2) { par[n] = i; q[tail++] = n; } }
    }
    return null;
  },

  launchBoat(fromId, targetIdx, amount) {
    const p = this.players[fromId];
    amount = Math.min(amount, p.balance);
    if (amount < CFG.BOAT_MIN) return 'weak';
    const coast = this.findCoast(targetIdx);
    if (coast < 0) return 'nocoast';
    const route = this.findSeaRoute(fromId, coast);
    if (!route) return 'noroute';
    p.balance -= amount;
    // limanlar gemi vergisini ve yolda erimeyi azaltır (deterministik artımlı çarpım)
    let disc = 1;
    for (let k = 0; k < p.bCount.port; k++) disc *= CFG.PORT_DISCOUNT;
    disc = Math.max(CFG.PORT_DISCOUNT_MIN, disc);
    const eff = amount * (1 - CFG.BOAT_TAX * disc);
    this.boats.push({
      id: this._boatSeq++,
      from: fromId,
      troops: eff,
      decay: eff * CFG.BOAT_ATTRITION * disc, // piksel başına sabit erime → uzun yolda batabilir
      path: route, pos: 0, recalled: false,
    });
    return 'ok';
  },

  // Saldırıyı iptal et: kalan asker eve döner
  cancelAttack(fromId, key) {
    const p = this.players[fromId];
    for (const att of p.attacks.values()) {
      if (String(att.key) === String(key)) {
        p.balance += att.troops;
        p.attacks.delete(att.key);
        return true;
      }
    }
    return false;
  },

  // Düşman gemisine deniz muharebesi: 1'e 1 asker takası, fazlası iade edilir.
  // Geminin askeri biterse batar.
  attackBoat(fromId, boatId, amount) {
    const b = this.boats.find(x => x.id === boatId);
    if (!b || b.from === fromId) return 'gone';
    if (this.allied(fromId, b.from) || this.hasPact(fromId, b.from)) return 'blocked';
    const p = this.players[fromId];
    amount = Math.min(amount, p.balance);
    if (amount < 10) return 'weak';
    const spent = Math.min(amount, b.troops); // ihtiyaçtan fazlası harcanmaz
    p.balance -= spent;
    b.troops -= spent;
    if (b.troops <= 0.5) {
      this.boats = this.boats.filter(x => x !== b);
      return { sunk: true, spent };
    }
    return { sunk: false, spent, remaining: b.troops };
  },

  // Gemiyi geri çağır: rotayı tersine çevirir, eve dönerken erime devam eder
  recallBoat(fromId, boatId) {
    const b = this.boats.find(x => x.from === fromId && x.id === boatId);
    if (!b || b.recalled) return false;
    const cut = Math.min(b.path.length - 1, Math.floor(b.pos));
    b.path = b.path.slice(0, cut + 1).reverse();
    b.pos = 0;
    b.recalled = true;
    return true;
  },

  // Bu hedefe kara sınırından saldırı mümkün mü?
  canLandAttack(fromId, targetId) {
    const { owner, terrain, W, H } = this;
    const p = this.players[fromId];
    for (const bi of p.border) {
      const x = bi % W, y = (bi / W) | 0;
      if ((x > 0 && terrain[bi - 1] === 1 && owner[bi - 1] === targetId) ||
          (x < W - 1 && terrain[bi + 1] === 1 && owner[bi + 1] === targetId) ||
          (y > 0 && terrain[bi - W] === 1 && owner[bi - W] === targetId) ||
          (y < H - 1 && terrain[bi + W] === 1 && owner[bi + W] === targetId)) return true;
    }
    return false;
  },

  // Bu hücreye deniz yolu var mı?
  canSeaAttack(fromId, targetIdx) {
    const coast = this.findCoast(targetIdx);
    if (coast < 0) return false;
    return this.findSeaRoute(fromId, coast) !== null;
  },

  landBoat(boat) {
    const { W, H, owner, terrain } = this;
    const p = this.players[boat.from];
    const w = boat.path[boat.path.length - 1];
    const x = w % W, y = (w / W) | 0;
    const beach = [];
    if (x > 0 && terrain[w - 1] === 1) beach.push(w - 1);
    if (x < W - 1 && terrain[w + 1] === 1) beach.push(w + 1);
    if (y > 0 && terrain[w - W] === 1) beach.push(w - W);
    if (y < H - 1 && terrain[w + W] === 1) beach.push(w + W);

    let cell = -1;
    for (const b of beach) {
      const o = owner[b];
      if (o === boat.from) continue;
      if (o > 0 && this.allied(boat.from, o)) continue; // müttefik kıyısına çıkarma yok
      if (o > 0 && this.hasPact(boat.from, o)) continue; // pakt ortağına da yok
      cell = b; break;
    }
    if (cell < 0) { p.balance += boat.troops; return; } // kıyı bizim/müttefikin

    const tgt = owner[cell];
    const tp = tgt > 0 ? this.players[tgt] : null;
    let cost;
    if (!tp || tp.pixels === 0 || tp.balance <= 0) cost = CFG.NEUTRAL_COST;
    else cost = Math.max(CFG.MIN_ENEMY_COST, (tp.balance / Math.max(1, tp.pixels)) * CFG.DEFENSE_MULT);
    if (boat.troops < cost) return; // çıkarma püskürtüldü

    boat.troops -= cost;
    if (tp && tp.pixels > 0) tp.balance = Math.max(0, tp.balance - cost / 2);
    this.setOwner(cell, boat.from);
    if (tp && tp.pixels === 0) this.eliminate(tp);

    // çıkarma noktasından yayılan yerel saldırı
    const att = {
      key: 's' + w + '_' + (this._boatSeq++),
      from: boat.from, target: tgt, troops: boat.troops,
      frontier: [], fset: new Set(), carry: 0, sea: true,
    };
    const addN = (n) => {
      if (terrain[n] === 1 && owner[n] === tgt && !att.fset.has(n)) { att.fset.add(n); att.frontier.push(n); }
    };
    const cx2 = cell % W, cy2 = (cell / W) | 0;
    if (cx2 > 0) addN(cell - 1);
    if (cx2 < W - 1) addN(cell + 1);
    if (cy2 > 0) addN(cell - W);
    if (cy2 < H - 1) addN(cell + W);
    for (const b of beach) if (owner[b] === tgt) addN(b);
    p.attacks.set(att.key, att);
  },

  // ---- Tick ----

  processTick() {
    this.tick++;
    const { W, H, owner, terrain } = this;

    // gemiler
    if (this.boats.length > 0) {
      const adv = CFG.BOAT_SPEED * CFG.TICK_MS / 1000;
      const keep = [];
      for (const b of this.boats) {
        b.pos += adv;
        b.troops -= b.decay * adv; // yolda erime
        if (b.troops <= 0) {
          if (this.onBoatSunk) this.onBoatSunk(b); // batış — asker kalmadı
        } else if (b.pos >= b.path.length - 1) {
          this.landBoat(b);
        } else {
          keep.push(b);
        }
      }
      this.boats = keep;
    }

    // saldırılar
    for (let id = 1; id < this.players.length; id++) {
      const p = this.players[id];
      if (p.attacks.size === 0) continue;
      const speed = attackSpeed(p.pixels) * CFG.TICK_MS / 1000; // piksel/tick
      const done = new Set();

      for (const att of p.attacks.values()) {
        att.carry += speed;
        let n = Math.floor(att.carry);
        att.carry -= n;
        const tgt = att.target > 0 ? this.players[att.target] : null;

        while (n > 0) {
          const pi = this.popFrontier(att);
          if (pi < 0) break;
          let baseCost;
          if (!tgt || tgt.pixels === 0 || tgt.balance <= 0) {
            baseCost = CFG.NEUTRAL_COST;
          } else {
            const dens = tgt.balance / Math.max(1, tgt.pixels);
            baseCost = Math.max(CFG.MIN_ENEMY_COST, dens * CFG.DEFENSE_MULT);
            if (this.towerProtects(tgt.id, pi)) baseCost *= CFG.TOWER_DEF_MULT; // kule bölgesi
          }
          // yönlü saldırı odaklıdır ama pahalıdır: saldıran 1.2 kat öder,
          // savunanın kaybı temel maliyet üzerinden hesaplanır
          const cost = att.dir >= 0 ? baseCost * CFG.DIRECTED_COST_MULT : baseCost;
          if (att.troops < cost) { done.add(att); break; }
          att.troops -= cost;
          if (tgt && tgt.pixels > 0) tgt.balance = Math.max(0, tgt.balance - baseCost / 2);
          this.setOwner(pi, p.id);
          // yeni cephe pikselleri
          const x = pi % W, y = (pi / W) | 0;
          let nb;
          if (x > 0) { nb = pi - 1; if (terrain[nb] === 1 && owner[nb] === att.target && !att.fset.has(nb)) { att.fset.add(nb); att.frontier.push(nb); } }
          if (x < W - 1) { nb = pi + 1; if (terrain[nb] === 1 && owner[nb] === att.target && !att.fset.has(nb)) { att.fset.add(nb); att.frontier.push(nb); } }
          if (y > 0) { nb = pi - W; if (terrain[nb] === 1 && owner[nb] === att.target && !att.fset.has(nb)) { att.fset.add(nb); att.frontier.push(nb); } }
          if (y < H - 1) { nb = pi + W; if (terrain[nb] === 1 && owner[nb] === att.target && !att.fset.has(nb)) { att.fset.add(nb); att.frontier.push(nb); } }
          n--;
          if (tgt && tgt.pixels === 0) this.eliminate(tgt);
        }

        if (!done.has(att) && att.frontier.length === 0) {
          if (!att.sea) this.refreshFrontier(att); // deniz saldırısı yereldir, sınırdan beslenmez
          if (att.frontier.length === 0) done.add(att);
        }
      }

      for (const att of done) {
        p.balance += att.troops; // kalan asker eve döner
        if (att.troops >= 1 && this.onTroopsReturn) this.onTroopsReturn(p.id, att.troops);
        p.attacks.delete(att.key);
      }
    }

    // Döngü sonu: gelir dağıtımı
    if (this.tick % CFG.TICKS_PER_CYCLE === 0) {
      this.cycle++;
      // artımlı çarpım: Math.pow tarayıcılar arası birebir aynı sonucu garanti etmez
      this.rate = Math.max(CFG.INTEREST_MIN, this.rate * CFG.INTEREST_DECAY);
      for (let id = 1; id < this.players.length; id++) {
        const p = this.players[id];
        if (!p.alive || p.pixels === 0) continue;
        const effPix = p.pixels + CFG.CITY_CAP_BONUS * p.bCount.city; // şehirler tavanı büyütür
        const maxB = CFG.MAX_BALANCE_MULT * effPix;
        const fullB = CFG.FULL_INCOME_MULT * effPix;
        let inc = p.balance * this.rate + p.pixels * CFG.LAND_INCOME;
        inc *= 1 + CFG.CITY_INCOME_BONUS * p.bCount.city; // şehir gelir bonusu
        if (p.balance > fullB) inc *= Math.max(0, (maxB - p.balance) / (maxB - fullB));
        p.balance = Math.min(maxB, p.balance + inc);
        p.lastIncome = inc;
      }
    }
  },

  eliminate(t) {
    t.alive = false;
    t.balance = 0;
    t.attacks.clear();
  },

  // ---- Komut yürütücü ----
  // Hem solo hem online tüm oyuncu eylemleri buradan geçer; online modda
  // aynı komut aynı tickte tüm istemcilerde çalışır → simülasyon özdeş kalır
  execCommand(pid, cmd) {
    const p = this.players[pid];
    if (!p) return;
    if (cmd.type !== 'spawn' && p.pixels === 0) return;
    switch (cmd.type) {
      case 'spawn':
        if (p.pixels === 0) this.spawn(p, cmd.x, cmd.y);
        break;
      case 'attack':
        this.launchAttack(pid, cmd.target, p.balance * cmd.pct / 100, cmd.dir);
        break;
      case 'boat':
        this.launchBoat(pid, cmd.cell, p.balance * cmd.pct / 100);
        break;
      case 'cancel': this.cancelAttack(pid, cmd.key); break;
      case 'recall': this.recallBoat(pid, cmd.boatId); break;
      case 'sink': this.attackBoat(pid, cmd.boatId, p.balance * cmd.pct / 100); break;
      case 'build': this.build(pid, cmd.cell, cmd.kind); break;
      case 'betray':
        if (this.breakPact(pid, cmd.target)) {
          this.launchAttack(pid, cmd.target, p.balance * cmd.pct / 100, cmd.dir);
        }
        break;
      case 'peace': {
        const t = this.players[cmd.target];
        if (!t || t.pixels === 0 || this.hasPact(pid, cmd.target) || this.isTraitor(pid)) break;
        if (t.isBot) {
          // bot kararı deterministik: tüm istemciler aynı sonucu üretir
          const accept = t.balance < p.balance * 0.9 ? this.rng() < 0.75 : this.rng() < 0.3 / t.aggr;
          if (accept) this.makePact(pid, cmd.target);
          if (this.onPeaceResult) this.onPeaceResult(pid, cmd.target, accept);
        } else {
          if (this.onHumanPeaceOffer) this.onHumanPeaceOffer(pid, cmd.target);
        }
        break;
      }
      case 'acceptPact':
        if (!this.isTraitor(cmd.target)) this.makePact(pid, cmd.target);
        if (this.onPeaceResult) this.onPeaceResult(cmd.target, pid, true);
        break;
    }
  },
};
