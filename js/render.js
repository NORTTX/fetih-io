// Çizim: offscreen piksel haritası + kamera (kaydırma/yakınlaştırma) + isim etiketleri
const Render = {
  canvas: null, ctx: null,
  off: null, octx: null, img: null, buf32: null,
  base32: null,
  zoom: 1, fitZoom: 1, ox: 0, oy: 0,

  init(canvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base32 = map.base32;
    this.off = document.createElement('canvas');
    this.off.width = CFG.MAP_W; this.off.height = CFG.MAP_H;
    this.octx = this.off.getContext('2d');
    this.img = this.octx.createImageData(CFG.MAP_W, CFG.MAP_H);
    this.buf32 = new Uint32Array(this.img.data.buffer);
    for (let i = 0; i < this.buf32.length; i++) this.buf32[i] = this.base32[i];
    this.octx.putImageData(this.img, 0, 0);
    this.resize();
    this.resetCamera();
  },

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  },

  resetCamera() {
    const fit = Math.min(this.canvas.width / CFG.MAP_W, this.canvas.height / CFG.MAP_H);
    this.fitZoom = fit;
    this.zoom = fit;
    this.ox = (this.canvas.width - CFG.MAP_W * fit) / 2;
    this.oy = (this.canvas.height - CFG.MAP_H * fit) / 2;
  },

  colorAt(i) {
    const o = Game.owner[i];
    if (o <= 0) return this.base32[i];
    const p = Game.players[o];
    return p.border.has(i) ? p.dark32 : p.col32;
  },

  flushDirty() {
    if (Game.dirty.size === 0) return;
    for (const i of Game.dirty) this.buf32[i] = this.colorAt(i);
    Game.dirty.clear();
    this.octx.putImageData(this.img, 0, 0);
  },

  screenToCell(sx, sy) {
    const x = Math.floor((sx - this.ox) / this.zoom);
    const y = Math.floor((sy - this.oy) / this.zoom);
    if (x < 0 || y < 0 || x >= CFG.MAP_W || y >= CFG.MAP_H) return -1;
    return y * CFG.MAP_W + x;
  },

  zoomAt(sx, sy, factor) {
    const nz = clamp(this.zoom * factor, this.fitZoom * 0.7, 16);
    const wx = (sx - this.ox) / this.zoom;
    const wy = (sy - this.oy) / this.zoom;
    this.ox = sx - wx * nz;
    this.oy = sy - wy * nz;
    this.zoom = nz;
  },

  draw() {
    this.flushDirty();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1018';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(this.zoom, 0, 0, this.zoom, this.ox, this.oy);
    ctx.drawImage(this.off, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBuildings(ctx);
    this.drawBoats(ctx);
    this.drawLabels(ctx);
    this.drawAim(ctx);
  },

  // Piksel bina sprite'ları — k: kontur, o: sahip rengi, w: duvar, g: cam,
  // s/S: taş (açık/koyu), r: kırmızı, W: beyaz, y: ışık, b: ahşap
  BUILDING_SPRITES: {
    // iki evli kasaba, üçgen çatılar sahibinin renginde
    city: [
      '...k.......k...',
      '..kok.....kok..',
      '.koook...koook.',
      'koooook.koooook',
      'kwwwwwk.kwwwwwk',
      'kwgwgwk.kwgwgwk',
      'kwwwwwk.kwwwwwk',
      'kwwkwwk.kwwkwwk',
      'kkkkkkk.kkkkkkk',
    ],
    // mazgallı taş burç, tepesinde sahip bayrağı
    tower: [
      '...koo.',
      '...koo.',
      '...k...',
      'kk.k.kk',
      'kSSSSSk',
      'kssssSk',
      'kssksSk',
      'kssssSk',
      'kssssSk',
      'kSSSSSk',
    ],
    // kırmızı-beyaz deniz feneri, tepe bandı sahibinin renginde
    port: [
      '..kkk..',
      '.kyyyk.',
      '..kkk..',
      '.koook.',
      '.kWWWk.',
      '.krrrk.',
      '.kWWWk.',
      '.krrrk.',
      'kkkkkkk',
      'kbbbbbk',
    ],
  },

  BUILDING_COLORS: {
    k: '#22262e', w: '#e6ddc4', g: '#8fc3e8', s: '#a7adb6', S: '#7d838d',
    r: '#c8433c', W: '#f1f1ee', y: '#ffe066', b: '#8a6b45',
  },

  drawBuildings(ctx) {
    const W = CFG.MAP_W;
    const pal = this.BUILDING_COLORS;
    for (const b of Game.buildings) {
      const spr = this.BUILDING_SPRITES[b.type];
      const rows = spr.length, cols = spr[0].length;
      const x = (b.idx % W) + 0.5, y = ((b.idx / W) | 0) + 0.5;
      const sx = x * this.zoom + this.ox;
      const sy = y * this.zoom + this.oy;
      if (sx < -60 || sy < -60 || sx > this.canvas.width + 60 || sy > this.canvas.height + 60) continue;
      const u = clamp(this.zoom * 0.55, 1.5, 5);
      const p = Game.players[b.owner];
      const ox0 = sx - cols * u / 2, oy0 = sy - rows * u / 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ch = spr[r][c];
          if (ch === '.') continue;
          ctx.fillStyle = ch === 'o' ? (p ? p.cssColor : '#888') : pal[ch];
          ctx.fillRect(ox0 + c * u, oy0 + r * u, u + 0.5, u + 0.5);
        }
      }
      // kule etki alanı: yakınlaştırınca ince halka
      if (b.type === 'tower' && this.zoom > 2) {
        ctx.beginPath();
        ctx.arc(sx, sy, CFG.BUILDINGS.tower.radius * this.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  },

  aim: null, // {from: hücre, toX, toY (ekran)} — yönlü saldırı oku

  drawAim(ctx) {
    if (!this.aim) return;
    const W = CFG.MAP_W;
    const x0 = ((this.aim.from % W) + 0.5) * this.zoom + this.ox;
    const y0 = (((this.aim.from / W) | 0) + 0.5) * this.zoom + this.oy;
    const x1 = this.aim.toX, y1 = this.aim.toY;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.strokeStyle = 'rgba(255, 226, 80, 0.9)';
    ctx.fillStyle = 'rgba(255, 226, 80, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.setLineDash([]);
    // ok başı
    const ah = 14;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ah * Math.cos(ang - 0.45), y1 - ah * Math.sin(ang - 0.45));
    ctx.lineTo(x1 - ah * Math.cos(ang + 0.45), y1 - ah * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
    // başlangıç noktası
    ctx.beginPath();
    ctx.arc(x0, y0, 5, 0, Math.PI * 2);
    ctx.fill();
  },

  // Piksel yelkenli: s = yelken (oyuncu rengi), m = direk, h = gövde
  BOAT_SPRITE: [
    '...s...',
    '..ss...',
    '.sss...',
    'ssssm..',
    '...m...',
    'hhhhhhh',
    '.hhhhh.',
  ],

  drawBoats(ctx) {
    const W = CFG.MAP_W;
    const spr = this.BOAT_SPRITE;
    const rows = spr.length, cols = spr[0].length;
    for (const b of Game.boats) {
      const i0 = b.path[Math.min(b.path.length - 1, Math.floor(b.pos))];
      const i1 = b.path[Math.min(b.path.length - 1, Math.floor(b.pos) + 1)];
      const x = (i0 % W) + 0.5, y = ((i0 / W) | 0) + 0.5;
      const sx = x * this.zoom + this.ox;
      const sy = y * this.zoom + this.oy;
      const flip = ((i1 % W) - (i0 % W)) < 0; // batıya gidiyorsa aynala
      const u = clamp(this.zoom * 0.55, 1.4, 6); // piksel birimi
      const p = Game.players[b.from];
      const ox0 = sx - cols * u / 2, oy0 = sy - rows * u / 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ch = spr[r][flip ? cols - 1 - c : c];
          if (ch === '.') continue;
          if (ch === 's') ctx.fillStyle = p.cssColor;
          else if (ch === 'm') ctx.fillStyle = '#e8e2d0';
          else ctx.fillStyle = '#6b4a2f';
          ctx.fillRect(ox0 + c * u, oy0 + r * u, u + 0.5, u + 0.5);
        }
      }
      if (this.zoom > 2.2) {
        ctx.font = `bold ${Math.max(9, this.zoom * 2.2)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.fillStyle = '#fff';
        ctx.strokeText(fmt(b.troops), sx, oy0 - 4);
        ctx.fillText(fmt(b.troops), sx, oy0 - 4);
      }
    }
  },

  drawLabels(ctx) {
    ctx.textAlign = 'center';
    for (let id = 1; id < Game.players.length; id++) {
      const p = Game.players[id];
      if (p.pixels < 250) continue;
      const size = Math.min(42, Math.sqrt(p.pixels) * this.zoom * 0.14);
      if (size < 7) continue;
      const cx = p.sumX / p.pixels, cy = p.sumY / p.pixels;
      const sx = cx * this.zoom + this.ox;
      const sy = cy * this.zoom + this.oy;
      ctx.font = `bold ${size}px "Segoe UI", sans-serif`;
      ctx.lineWidth = Math.max(1.5, size / 9);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.fillStyle = '#ffffff';
      ctx.strokeText(p.name, sx, sy);
      ctx.fillText(p.name, sx, sy);
      const s2 = size * 0.72;
      ctx.font = `${s2}px "Segoe UI", sans-serif`;
      ctx.lineWidth = Math.max(1, s2 / 9);
      ctx.strokeText(fmt(p.balance), sx, sy + size * 0.95);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(fmt(p.balance), sx, sy + size * 0.95);
    }
  },
};
