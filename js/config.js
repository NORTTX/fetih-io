// Oyun ayarları — dengeleme buradan yapılır
const CFG = {
  MAP_W: 960,
  MAP_H: 600,

  // Zaman: ince tick = akıcı yayılma; döngü yine 5.6sn (80 × 70ms, Territorial ile aynı)
  TICK_MS: 70,
  TICKS_PER_CYCLE: 80,

  // Başlangıç
  START_BALANCE: 512,
  SPAWN_RADIUS: 6,
  BOT_COUNT: 26,
  MIN_SPAWN_DIST: 46,

  // Ekonomi (Territorial.io kuralları)
  INTEREST_START: 0.07,    // döngü başına %7 ile başlar
  INTEREST_DECAY: 0.995,   // her döngü azalır (yavaş düşüş = uzun büyüme evresi)
  INTEREST_MIN: 0.008,
  MAX_BALANCE_MULT: 150,   // maks güç = piksel × 150
  FULL_INCOME_MULT: 100,   // tam gelir sınırı = piksel × 100 (üstü kırmızı)
  LAND_INCOME: 0.12,       // piksel başına taban gelir (toparlanma için)

  // Saldırı
  ATTACK_TAX: 12 / 1024,   // %1.17 saldırı vergisi
  NEUTRAL_COST: 1.0,       // boş kara pikseli maliyeti
  MIN_ENEMY_COST: 1.5,
  DEFENSE_MULT: 2.0,       // savunma 2 kat güçlü
  DIRECTED_COST_MULT: 1.2, // yönlü (okla) saldırıda piksel başına 1.2 kat asker gider

  // Diplomasi
  TRAITOR_CYCLES: 20,      // ihanet sonrası bu kadar döngü kimse pakt yapmaz (~2 dk)

  // Binalar: fetheden binayı ele geçirir; maliyet her yeni binada katlanır
  BUILDINGS: {
    city:  { cost: 2000, mult: 2.0 },
    tower: { cost: 35000, mult: 1.6, radius: 22 },
    port:  { cost: 3000, mult: 1.5 },
  },
  CITY_INCOME_BONUS: 0.10, // şehir başına +%10 gelir
  CITY_CAP_BONUS: 1500,    // şehir başına güç tavanına sanal piksel
  TOWER_DEF_MULT: 2.0,     // kule bölgesinde savunma ekstra 2 kat
  PORT_DISCOUNT: 0.8,      // her liman gemi vergisi + erimeyi 0.8x yapar
  PORT_DISCOUNT_MIN: 0.4,
  BUILD_MIN_DIST: 8,       // iki bina arası asgari mesafe (piksel)
  SPEED_SCALE: 6,          // yayılma hızı çarpanı (harita küçük olduğu için)

  // Gemiler (Territorial: gemi maliyeti dengenin %3.125'i)
  BOAT_TAX: 32 / 1024,
  BOAT_SPEED: 9,           // piksel/sn
  BOAT_ATTRITION: 0.0015,  // her pikselde başlangıç askerinin bu oranı erir
                           // (≈660 piksellik menzil; asker biterse gemi batar)
  BOAT_MIN: 50,            // gemi için asgari asker

  // Botlar
  BOT_DECIDE_TICKS: 64,    // ~4.5 saniyede bir karar
};

// Score'a göre yayılma hızı (piksel/sn) — Territorial tablosunun ölçeklisi
function attackSpeed(score) {
  let s;
  if (score < 2000) s = 6;
  else if (score < 6000) s = 9;
  else if (score < 12000) s = 13;
  else if (score < 25000) s = 19;
  else if (score < 50000) s = 28;
  else if (score < 100000) s = 40;
  else s = 65;
  return s * CFG.SPEED_SCALE;
}

// ---- Yardımcılar ----

function packRGB(r, g, b) {
  return (255 << 24) | (b << 16) | (g << 8) | r; // little-endian ABGR
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

function darkenRGB(c, f) {
  return { r: (c.r * f) | 0, g: (c.g * f) | 0, b: (c.b * f) | 0 };
}

function fmt(n) {
  n = Math.floor(n);
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
