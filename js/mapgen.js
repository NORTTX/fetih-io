// Prosedürel harita üretimi: tek büyük ana kara + dekoratif adalar,
// deniz kıyıya yaklaştıkça açılan, hafif grenli tonlarda.
const MapGen = (() => {

  function hash2(x, y, seed) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 974634211);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  function valueNoise(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  function fbm(x, y, seed) {
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < 5; o++) {
      v += amp * valueNoise(x * f, y * f, seed + o * 101);
      amp *= 0.5; f *= 2;
    }
    return v; // ~[0,1]
  }

  // Deniz paleti: kıyıdan derine (bant 0 = kıyı, en açık)
  const WATER_BANDS = [
    [156, 184, 204],
    [138, 170, 192],
    [120, 155, 181],
    [102, 140, 168],
    [86, 124, 153],
    [70, 108, 137],
  ];
  const DEPTH_LIMITS = [2, 5, 9, 15, 24]; // bant eşikleri (piksel uzaklık)

  const NEUTRAL_LAND = [178, 170, 148]; // ana kara: tek düz renk

  function buildTerrain(seed, template) {
    const W = CFG.MAP_W, H = CFG.MAP_H;
    const terrain = new Uint8Array(W * H); // 1 = kara
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const nx = x / W, ny = y / H;
        let v;
        if (template === 'arch') {
          // Takımada: yüksek frekans, hafif kenar zayıflatması → irili ufaklı adalar
          const dx = (nx - 0.5) * 2, dy = (ny - 0.5) * 2;
          v = fbm(x * 0.010, y * 0.010, seed) + 0.10 - 0.14 * (dx * dx + dy * dy);
        } else if (template === 'duo') {
          // İki Kıta: sol ve sağda iki merkez, ortada deniz şeridi
          const dA = Math.hypot((nx - 0.27) * 2.6, (ny - 0.5) * 2.0);
          const dB = Math.hypot((nx - 0.73) * 2.6, (ny - 0.5) * 2.0);
          const d = Math.min(dA, dB);
          v = fbm(x * 0.008, y * 0.008, seed) + 0.26 - 0.55 * d * d;
          if (Math.abs(nx - 0.5) < 0.045) v -= 0.3; // orta boğaz hep deniz
          const e = Math.min(nx, 1 - nx, ny, 1 - ny); // kenarlar deniz kalsın
          if (e < 0.07) v -= (0.07 - e) * 5;
        } else {
          // Tek kıta: kenarlara doğru zayıflatma
          const dx = (nx - 0.5) * 2, dy = (ny - 0.5) * 2;
          const d2 = dx * dx + dy * dy;
          v = fbm(x * 0.007, y * 0.007, seed) + 0.30 - 0.38 * d2 - 0.12 * Math.sqrt(d2);
        }
        if (v > 0.5 && x > 3 && y > 3 && x < W - 4 && y < H - 4) terrain[y * W + x] = 1;
      }
    }
    return terrain;
  }

  // Bağlı kara parçalarını bul; MIN_COMP üstündekiler spawn alanı sayılır
  // (dünya haritasında tüm kıtalar, rastgele haritada ana kara + büyük adalar)
  const MIN_COMP = 1500;
  function findSpawnable(terrain) {
    const W = CFG.MAP_W, H = CFG.MAP_H, N = W * H;
    const comp = new Int32Array(N).fill(-1);
    const queue = new Int32Array(N);
    let largest = 0, nextId = 0;
    const sizes = [];
    for (let s = 0; s < N; s++) {
      if (terrain[s] !== 1 || comp[s] !== -1) continue;
      const id = nextId++;
      let head = 0, tail = 0, size = 0;
      queue[tail++] = s; comp[s] = id;
      while (head < tail) {
        const i = queue[head++]; size++;
        const x = i % W, y = (i / W) | 0;
        if (x > 0 && terrain[i - 1] === 1 && comp[i - 1] === -1) { comp[i - 1] = id; queue[tail++] = i - 1; }
        if (x < W - 1 && terrain[i + 1] === 1 && comp[i + 1] === -1) { comp[i + 1] = id; queue[tail++] = i + 1; }
        if (y > 0 && terrain[i - W] === 1 && comp[i - W] === -1) { comp[i - W] = id; queue[tail++] = i - W; }
        if (y < H - 1 && terrain[i + W] === 1 && comp[i + W] === -1) { comp[i + W] = id; queue[tail++] = i + W; }
      }
      sizes[id] = size;
      if (size > largest) largest = size;
    }
    const spawnable = new Uint8Array(N);
    let spawnableCount = 0;
    for (let i = 0; i < N; i++) {
      if (comp[i] >= 0 && sizes[comp[i]] >= MIN_COMP) { spawnable[i] = 1; spawnableCount++; }
    }
    return { spawnable, spawnableCount, largest };
  }

  // Sudan karaya uzaklık (BFS) → derinlik bantları
  function waterDepth(terrain) {
    const W = CFG.MAP_W, H = CFG.MAP_H, N = W * H;
    const depth = new Int32Array(N).fill(-1);
    const queue = new Int32Array(N);
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) {
      if (terrain[i] === 1) { depth[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % W, y = (i / W) | 0, d = depth[i] + 1;
      if (d > 30) continue;
      if (x > 0 && depth[i - 1] === -1) { depth[i - 1] = d; queue[tail++] = i - 1; }
      if (x < W - 1 && depth[i + 1] === -1) { depth[i + 1] = d; queue[tail++] = i + 1; }
      if (y > 0 && depth[i - W] === -1) { depth[i - W] = d; queue[tail++] = i - W; }
      if (y < H - 1 && depth[i + W] === -1) { depth[i + W] = d; queue[tail++] = i + W; }
    }
    return depth;
  }

  function buildBaseColors(terrain, depth) {
    const W = CFG.MAP_W, H = CFG.MAP_H, N = W * H;
    const base32 = new Uint32Array(N);
    const landCol = packRGB(NEUTRAL_LAND[0], NEUTRAL_LAND[1], NEUTRAL_LAND[2]);
    for (let i = 0; i < N; i++) {
      if (terrain[i] === 1) { base32[i] = landCol; continue; }
      const d = depth[i] < 0 ? 999 : depth[i];
      let b = WATER_BANDS.length - 1;
      for (let k = 0; k < DEPTH_LIMITS.length; k++) {
        if (d <= DEPTH_LIMITS[k]) { b = k; break; }
      }
      const c = WATER_BANDS[b];
      // parçalı/grenli doku: piksel başına küçük parlaklık oynaması
      const j = ((hash2(i % W, (i / W) | 0, 777) - 0.5) * 20) | 0;
      base32[i] = packRGB(
        clamp(c[0] + j, 0, 255),
        clamp(c[1] + j, 0, 255),
        clamp(c[2] + j, 0, 255)
      );
    }
    return base32;
  }

  // Ortak boru hattı: arazi → spawn alanları + derinlik + renkler
  function finish(terrain) {
    let landCount = 0;
    for (let i = 0; i < terrain.length; i++) landCount += terrain[i];
    const { spawnable, spawnableCount } = findSpawnable(terrain);
    const depth = waterDepth(terrain);
    const base32 = buildBaseColors(terrain, depth);
    return { terrain, spawnable, spawnableCount, landCount, base32 };
  }

  function generate(seed, template) {
    // yeterli spawn alanı olana kadar dene
    for (let t = 0; t < 12; t++) {
      const terrain = buildTerrain(seed + t * 7919, template);
      const { spawnableCount } = findSpawnable(terrain);
      if (spawnableCount < CFG.MAP_W * CFG.MAP_H * 0.13) continue;
      return finish(terrain);
    }
    throw new Error('Harita üretilemedi');
  }

  // RLE kara maskesinden harita (gerçek dünya haritası)
  // DİKKAT: çağırmadan önce CFG.MAP_W/H maskenin boyutuna ayarlanmış olmalı
  function fromMask(mask) {
    const N = mask.w * mask.h;
    const terrain = new Uint8Array(N);
    const runs = mask.rle.split(',');
    let pos = 0, val = 0;
    for (const r of runs) {
      const len = +r;
      if (val === 1) terrain.fill(1, pos, pos + len);
      pos += len;
      val = 1 - val;
    }
    return finish(terrain);
  }

  return { generate, fromMask };
})();
