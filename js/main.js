// Ana döngü, girişler ve arayüz
(() => {
  const BOT_NAMES = [
    'Roma', 'Osmanlı', 'Pers', 'Kartaca', 'Vikingler', 'Moğollar', 'Prusya',
    'Babil', 'Aztek', 'İnka', 'Mısır', 'Sparta', 'Atina', 'Hitit', 'Asur',
    'Galya', 'Keltler', 'Frigya', 'Lidya', 'Nubya', 'Fenike', 'Makedonya',
    'Hunlar', 'Bizans', 'Songhay', 'Maya', 'Kuşan', 'Elam', 'Urartu', 'Timurlular',
  ];

  const canvas = document.getElementById('canvas');
  const $ = id => document.getElementById(id);

  let state = 'pick'; // pick | play | over
  let attackPct = 25;
  let map = null;
  let human = null;
  let mapType = 'world'; // world | random
  let booted = false;
  const settings = { players: 27, teams: 0 }; // teams: 0 = FFA
  const TEAM_HUES = [45, 210, 0, 130]; // takım 1 = altın (insan takımı)

  // ---- Kurulum ----

  const MAP_MASKS = { world: () => WORLD_MASK, europe: () => EUROPE_MASK, med: () => MED_MASK };
  const MAP_TEMPLATES = { random: 'continent', arch: 'arch', duo: 'duo' };

  function boot(type) {
    mapType = type;
    if (MAP_MASKS[type]) {
      const mask = MAP_MASKS[type]();
      CFG.MAP_W = mask.w;
      CFG.MAP_H = mask.h;
      map = MapGen.fromMask(mask);
    } else {
      CFG.MAP_W = 960;
      CFG.MAP_H = 600;
      map = MapGen.generate((Math.random() * 1e9) | 0, MAP_TEMPLATES[type]);
    }
    Game.init(map);
    Game.onBoatSunk = b => {
      if (b.from === Game.humanId) toast('⛵ Gemin denizde battı — asker tükendi');
    };
    Game.onPactBroken = (byId, otherId) => {
      if (otherId === Game.humanId) toast('🗡️ ' + Game.players[byId].name + ' paktı bozdu — savaş!');
    };
    Game.onTroopsReturn = (id, n) => {
      if (id === Game.humanId && n >= 100) toast('🏠 ' + fmt(n) + ' asker eve döndü');
    };
    const BNAMES = { city: 'Şehir', tower: 'Kule', port: 'Liman' };
    Game.onBuildingCaptured = (bld, newOwner, prevOwner) => {
      if (newOwner === Game.humanId) toast('🎉 ' + BNAMES[bld.type] + ' ele geçirdin!');
      else if (prevOwner === Game.humanId) toast('💔 ' + BNAMES[bld.type] + "'ni kaybettin");
    };
    Bots.onOffer = botId => addOffer(botId);
    $('offers').innerHTML = '';
    human = Game.addPlayer('Sen', { r: 240, g: 200, b: 60 }, false);
    Render.init(canvas, map);
    document.querySelectorAll('#mapselect button').forEach(b =>
      b.classList.toggle('active', b.dataset.m === type));
    if (!booted) { booted = true; requestAnimationFrame(frame); }
  }

  document.querySelectorAll('#mapselect button').forEach(b =>
    b.addEventListener('click', () => { if (state === 'pick') boot(b.dataset.m); }));

  $('set-players').addEventListener('input', e => {
    settings.players = +e.target.value;
    $('set-players-val').textContent = e.target.value;
  });
  document.querySelectorAll('#set-teams button').forEach(b =>
    b.addEventListener('click', () => {
      if (state !== 'pick') return;
      settings.teams = +b.dataset.t;
      document.querySelectorAll('#set-teams button').forEach(x =>
        x.classList.toggle('active', x === b));
    }));

  function startGame(cx, cy) {
    if (settings.teams > 0) human.team = 1;
    Game.spawn(human, cx, cy);
    spawnBots(cx, cy);
    state = 'play';
    $('banner').classList.add('hidden');
    $('mapselect').classList.add('hidden');
    $('settings').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('lb').classList.remove('hidden');
    $('piepanel').classList.remove('hidden');
    $('bottom').classList.remove('hidden');
    lastTime = performance.now();
  }

  function spawnBots(hx, hy) {
    const { W, H } = Game;
    const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
    const spots = [[hx, hy]];
    const botCount = clamp(settings.players - 1, 1, 60);
    let placed = 0;
    for (let b = 0; b < botCount; b++) {
      let found = null;
      for (let t = 0; t < 800; t++) {
        const i = (Math.random() * W * H) | 0;
        if (Game.spawnable[i] !== 1 || Game.owner[i] !== 0) continue;
        const x = i % W, y = (i / W) | 0;
        let ok = true;
        for (const [sx, sy] of spots) {
          const dx = x - sx, dy = y - sy;
          if (dx * dx + dy * dy < CFG.MIN_SPAWN_DIST * CFG.MIN_SPAWN_DIST) { ok = false; break; }
        }
        if (ok) { found = [x, y]; break; }
      }
      if (!found) continue;
      spots.push(found);
      const team = settings.teams > 0 ? (b % settings.teams) + 1 : 0;
      let col;
      if (settings.teams > 0) {
        // takım rengi: aynı ton, üyeler sadece açıklıkla ayrılır → takımlar net görünür
        const hue = TEAM_HUES[(team - 1) % TEAM_HUES.length];
        const member = (b / settings.teams) | 0;
        col = hslToRgb(hue, 62, 36 + (member % 4) * 7);
      } else {
        const hue = (placed * 137.508) % 360;
        col = hslToRgb(hue, 52 + (placed % 3) * 9, 42 + (placed % 4) * 6);
      }
      const nm = names[placed % names.length] + (placed >= names.length ? ' ' + (((placed / names.length) | 0) + 1) : '');
      const bot = Game.addPlayer(nm, col, true);
      if (settings.teams > 0) bot.team = team;
      Game.spawn(bot, found[0], found[1]);
      placed++;
    }
  }

  // ---- Oyun döngüsü ----

  let lastTime = 0, acc = 0, hudTimer = 0;

  function frame(now) {
    if (state === 'play') {
      acc += now - lastTime;
      lastTime = now;
      let guard = 0;
      while (acc >= CFG.TICK_MS && guard++ < 24) {
        Game.processTick();
        Bots.tick();
        acc -= CFG.TICK_MS;
        if (Game.tick % CFG.TICKS_PER_CYCLE === 0) checkEnd();
      }
      if (acc > CFG.TICK_MS * 4) acc = CFG.TICK_MS * 4; // sekme geri planda kaldıysa birikimi at
      if (now - hudTimer > 150) { hudTimer = now; updateHUD(); updateLeaderboard(); }
      if (human.pixels === 0) checkEnd();
    } else {
      lastTime = now;
    }
    Render.draw();
    requestAnimationFrame(frame);
  }

  function checkEnd() {
    if (state !== 'play') return;
    if (human.pixels === 0) {
      endGame(false, 'Toprakların tamamen fethedildi.');
      return;
    }
    let sharePix = human.pixels, enemyAlive = false;
    if (settings.teams > 0) {
      sharePix = 0;
      for (const p of Game.players) {
        if (!p || p.pixels === 0) continue;
        if (p.team === human.team) sharePix += p.pixels;
        else enemyAlive = true;
      }
    } else {
      enemyAlive = Game.players.some(p => p && p.id !== human.id && p.pixels > 0);
    }
    const share = sharePix / Game.spawnableCount;
    if (share >= 0.6 || !enemyAlive) {
      endGame(true, settings.teams > 0
        ? `Takımın dünyanın %${Math.round(share * 100)}'ini ele geçirdi!`
        : `Dünyanın %${Math.round(share * 100)}'ini ele geçirdin!`);
    }
  }

  function endGame(win, msg) {
    state = 'over';
    $('attacklist').classList.add('hidden');
    $('offers').innerHTML = '';
    hideMenu();
    $('overlay-title').textContent = win ? 'ZAFER!' : 'YENİLDİN';
    $('overlay-title').style.color = win ? '#6fd06f' : '#ff6b5e';
    $('overlay-msg').textContent = msg;
    $('overlay').classList.remove('hidden');
  }

  $('btn-restart').addEventListener('click', () => location.reload());

  // ---- Arayüz ----

  function updateHUD() {
    const fullB = CFG.FULL_INCOME_MULT * human.pixels;
    const maxB = CFG.MAX_BALANCE_MULT * human.pixels;
    const red = human.balance > fullB;
    const bal = $('hud-balance');
    bal.textContent = fmt(human.balance);
    bal.classList.toggle('redline', red);
    const fill = $('hud-balfill');
    fill.style.width = maxB > 0 ? Math.min(100, human.balance / maxB * 100).toFixed(1) + '%' : '0%';
    fill.classList.toggle('redline', red);
    $('hud-income').textContent = '+' + fmt(human.lastIncome) + ' / döngü';
    $('hud-rate').textContent = '%' + (Game.rate * 100).toFixed(2);
    $('hud-land').textContent = fmt(human.pixels) + ' (%' + (human.pixels / Game.spawnableCount * 100).toFixed(1) + ')';
    $('hud-buildings').textContent =
      '🏙️' + human.bCount.city + ' 🗼' + human.bCount.tower + ' ⚓' + human.bCount.port;
    $('hud-cyclefill').style.width =
      ((Game.tick % CFG.TICKS_PER_CYCLE) / CFG.TICKS_PER_CYCLE * 100).toFixed(0) + '%';

    // devam eden saldırılar ve gemiler (güç barının üstünde, iptal düğmeli)
    let ah = '';
    for (const att of human.attacks.values()) {
      const nm = att.target === 0 ? 'Boş arazi' : Game.players[att.target].name;
      ah += `<div class="atkrow"><span>${att.sea ? '⛵ ' : '⚔️ '}${nm}</span>` +
            `<span class="atktroops">${fmt(att.troops)}</span>` +
            `<button class="atkx" data-key="${att.key}" title="Saldırıyı iptal et">✕</button></div>`;
    }
    for (const b of Game.boats) {
      if (b.from !== human.id) continue;
      ah += `<div class="atkrow"><span>⛵ ${b.recalled ? 'geri dönüyor' : 'yolda'}</span>` +
            `<span class="atktroops">${fmt(b.troops)}</span>` +
            (b.recalled ? '' : `<button class="atkx" data-boat="${b.id}" title="Gemiyi geri çağır">↩</button>`) +
            `</div>`;
    }
    $('attacklist').innerHTML = ah;
    $('attacklist').classList.toggle('hidden', ah === '');
  }

  $('attacklist').addEventListener('click', e => {
    const el = e.target;
    if (el.dataset.key !== undefined) {
      if (Game.cancelAttack(human.id, el.dataset.key)) toast('Saldırı iptal — askerler eve döndü');
    } else if (el.dataset.boat !== undefined) {
      if (Game.recallBoat(human.id, +el.dataset.boat)) toast('⛵ Gemi geri çağrıldı');
    }
  });

  function updateLeaderboard() {
    const rows = Game.players
      .filter(p => p && p.pixels > 0)
      .sort((a, b) => b.pixels - a.pixels)
      .slice(0, 10);
    let html = '<h3>LİDERLİK</h3>';
    for (const p of rows) {
      const pct = (p.pixels / Game.spawnableCount * 100).toFixed(1);
      const me = p.id === Game.humanId ? ' me' : '';
      const tag = settings.teams > 0 ? `<span class="lbteam">T${p.team}</span>` : '';
      const dove = p.id !== Game.humanId && Game.hasPact(Game.humanId, p.id) ? ' 🕊️' : '';
      html += `<div class="lbrow${me}"><span class="lbdot" style="background:${p.cssColor}"></span>` +
              `${tag}<span class="lbname">${p.name}${dove}</span><span class="lbpct">%${pct}</span></div>`;
    }
    $('lb').innerHTML = html;
    updatePie();
  }

  // Arazi paylaşım pastası: takım modunda takımlar, FFA'da oyuncular
  function updatePie() {
    const cv = $('pie'), c2 = cv.getContext('2d');
    const S = cv.width, cx = S / 2, cy = S / 2, R = S / 2 - 4, r = R * 0.55;
    c2.clearRect(0, 0, S, S);

    const total = Game.spawnableCount;
    const slices = [];
    if (settings.teams > 0) {
      const teamPix = new Array(settings.teams + 1).fill(0);
      for (const p of Game.players) {
        if (p && p.pixels > 0 && p.team >= 1 && p.team <= settings.teams) teamPix[p.team] += p.pixels;
      }
      for (let t = 1; t <= settings.teams; t++) {
        if (teamPix[t] === 0) continue;
        const col = hslToRgb(TEAM_HUES[(t - 1) % TEAM_HUES.length], 62, 46);
        slices.push({ frac: teamPix[t] / total, css: `rgb(${col.r},${col.g},${col.b})` });
      }
    } else {
      const rows = Game.players
        .filter(p => p && p.pixels > 0)
        .sort((a, b) => b.pixels - a.pixels);
      let shown = 0;
      for (let k = 0; k < rows.length; k++) {
        if (k < 12) { slices.push({ frac: rows[k].pixels / total, css: rows[k].cssColor }); shown += rows[k].pixels; }
      }
      const rest = rows.slice(12).reduce((s, p) => s + p.pixels, 0);
      if (rest > 0) slices.push({ frac: rest / total, css: '#7a828c' });
    }
    // kalan tarafsız arazi
    const used = slices.reduce((s, x) => s + x.frac, 0);
    if (used < 1) slices.push({ frac: 1 - used, css: '#b2aa94' });

    let ang = -Math.PI / 2;
    for (const s of slices) {
      const a2 = ang + s.frac * Math.PI * 2;
      c2.beginPath();
      c2.moveTo(cx, cy);
      c2.arc(cx, cy, R, ang, a2);
      c2.closePath();
      c2.fillStyle = s.css;
      c2.fill();
      ang = a2;
    }
    // ortası delik (halka) + kendi payın
    c2.globalCompositeOperation = 'destination-out';
    c2.beginPath(); c2.arc(cx, cy, r, 0, Math.PI * 2); c2.fill();
    c2.globalCompositeOperation = 'source-over';

    let myPix = human.pixels;
    if (settings.teams > 0) {
      myPix = 0;
      for (const p of Game.players) if (p && p.team === human.team) myPix += p.pixels;
    }
    c2.fillStyle = '#fff';
    c2.font = 'bold 20px "Segoe UI", sans-serif';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText('%' + (myPix / total * 100).toFixed(1), cx, cy - 8);
    c2.fillStyle = '#93a3b5';
    c2.font = '11px "Segoe UI", sans-serif';
    c2.fillText(settings.teams > 0 ? 'takımın' : 'senin', cx, cy + 12);
  }

  function setPct(v) {
    attackPct = clamp(v | 0, 1, 100);
    $('pct').value = attackPct;
    $('pct-label').textContent = 'Saldırı: %' + attackPct;
  }

  $('pct').addEventListener('input', e => setPct(+e.target.value));
  document.querySelectorAll('#presets button').forEach(b =>
    b.addEventListener('click', () => setPct(+b.dataset.p)));

  window.addEventListener('keydown', e => {
    if (e.key === '1') setPct(10);
    else if (e.key === '2') setPct(25);
    else if (e.key === '3') setPct(50);
    else if (e.key === '4') setPct(100);
  });

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  // ---- Fare ----
  // Kendi toprağından sürükle = yönlü saldırı oku; başka yerden sürükle veya
  // sağ tuşla sürükle = kaydır; tıkla = ⚔️/⛵ menüsü; tekerlek = yakınlaştır

  let mouseDown = false, panning = false, aiming = false, aimStartCell = -1;
  let lastMX = 0, lastMY = 0, downX = 0, downY = 0;

  canvas.addEventListener('mousedown', e => {
    mouseDown = true; panning = false; aiming = false;
    downX = lastMX = e.clientX; downY = lastMY = e.clientY;
    if (e.button === 0 && state === 'play') {
      const i = Render.screenToCell(e.clientX, e.clientY);
      if (i >= 0 && Game.owner[i] === Game.humanId) {
        aiming = true; aimStartCell = i; hideMenu();
      }
    }
  });

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('mousemove', e => {
    if (!mouseDown) return;
    const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY) > 6;
    if (aiming) {
      Render.aim = moved ? { from: aimStartCell, toX: e.clientX, toY: e.clientY } : null;
    } else {
      if (!panning && moved) { panning = true; hideMenu(); }
      if (panning) { Render.ox += dx; Render.oy += dy; }
    }
    lastMX = e.clientX; lastMY = e.clientY;
  });

  window.addEventListener('mouseup', e => {
    if (!mouseDown) return;
    mouseDown = false;
    if (aiming) {
      aiming = false;
      const hadArrow = Render.aim !== null;
      Render.aim = null;
      if (hadArrow) handleAimRelease(e.clientX, e.clientY);
      else handleClick(e.clientX, e.clientY); // sürüklemeden bırakıldı → normal tıklama (inşa menüsü)
      return;
    }
    if (panning) return;
    if (e.button !== 0) return;
    handleClick(e.clientX, e.clientY);
  });

  // Ok bırakıldı: hedefe DOĞRU yönlü saldırı (sınır yoksa gemi)
  function handleAimRelease(sx, sy) {
    let i = Render.screenToCell(sx, sy);
    if (i < 0) return;
    if (Game.terrain[i] !== 1) {
      const n = nearestLand(i);
      if (n < 0) { toast('Açık deniz'); return; }
      i = n;
    }
    const t = Game.owner[i];
    if (t === human.id) return;
    if (t > 0 && Game.allied(human.id, t)) { toast('Müttefik toprağına saldıramazsın'); return; }
    if (t > 0 && Game.hasPact(human.id, t)) { toast('🕊️ Pakt var — bozmak için menüden 🗡️ kullan'); return; }
    const amount = human.balance * attackPct / 100;
    if (amount < 10) { toast('Yeterli gücün yok'); return; }
    if (Game.canLandAttack(human.id, t)) {
      Game.launchAttack(human.id, t, amount, i);
    } else {
      const r = Game.launchBoat(human.id, i, amount);
      if (r === 'ok') toast('⛵ Gemi yola çıktı');
      else if (r === 'weak') toast('Gemi için en az ' + CFG.BOAT_MIN + ' güç gerek');
      else if (r === 'nocoast') toast('Hedefin ulaşılabilir kıyısı yok');
      else if (r === 'noroute') toast('Deniz yolu bulunamadı');
    }
  }

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    hideMenu();
    Render.zoomAt(e.clientX, e.clientY, Math.pow(1.1, -e.deltaY / 100));
  }, { passive: false });

  function handleClick(sx, sy) {
    const i = Render.screenToCell(sx, sy);
    if (i < 0) return;

    if (state === 'pick') {
      if (Game.spawnable[i] !== 1) { toast('Bir kıtada yer seç (çok küçük adalar olmaz)'); return; }
      startGame(i % Game.W, (i / Game.W) | 0);
      return;
    }
    if (state !== 'play' || human.pixels === 0) return;

    // önce gemi kontrolü: tıklama bir düşman gemisinin üstündeyse muharebe menüsü
    const boat = findBoatAt(sx, sy);
    if (boat) {
      if (boat.from === human.id) { toast('Kendi gemin — geri çağırmak için listedeki ↩'); return; }
      if (Game.allied(human.id, boat.from) || Game.hasPact(human.id, boat.from)) { toast('Dost gemisi'); return; }
      showBoatMenu(sx, sy, boat);
      return;
    }

    // suya tıklandıysa yakındaki karayı hedefle
    if (Game.terrain[i] !== 1) {
      const n = nearestLand(i);
      if (n < 0) { hideMenu(); toast('Açık deniz — bir kıyıya tıkla'); return; }
      i = n;
    }
    const target = Game.owner[i];
    if (target === human.id) { hideMenu(); showBuildMenu(sx, sy, i); return; } // kendi toprağın → inşa
    if (target > 0 && Game.allied(human.id, target)) { hideMenu(); toast('Müttefik toprağı'); return; }

    // seçenekleri hesapla ve ⚔️/⛵ menüsünü aç
    const canLand = Game.canLandAttack(human.id, target);
    const canSea = Game.canSeaAttack(human.id, i);
    if (!canLand && !canSea) { hideMenu(); toast('Bu hedefe ne karadan ne denizden ulaşılabiliyor'); return; }
    showMenu(sx, sy, i, target, canLand, canSea);
  }

  // ---- Saldırı seçim menüsü (⚔️ kara / ⛵ deniz) ----

  let pending = null; // {cell, target}

  function showMenu(sx, sy, cell, target, canLand, canSea) {
    pending = { cell, target };
    const m = $('actmenu');
    $('act-sink').classList.add('hidden');
    $('act-land').classList.remove('hidden');
    $('act-sea').classList.remove('hidden');
    const pact = target > 0 && Game.hasPact(Game.humanId, target);
    const landBtn = $('act-land');
    landBtn.textContent = pact ? '🗡️' : '⚔️';
    landBtn.title = pact ? 'İhanet et ve saldır' : 'Karadan saldır';
    landBtn.classList.toggle('disabled', !canLand);
    $('act-sea').classList.toggle('disabled', !canSea || pact);
    const pb = $('act-peace');
    pb.textContent = pact ? '🕊️' : '🤝';
    pb.title = pact ? 'Pakt zaten var' : 'Barış teklif et';
    pb.classList.toggle('hidden', target === 0);
    pb.classList.toggle('disabled', target === 0 || pact || Game.isTraitor(Game.humanId));
    m.classList.remove('hidden');
    const r = m.getBoundingClientRect();
    m.style.left = clamp(sx - r.width / 2, 4, window.innerWidth - r.width - 4) + 'px';
    m.style.top = clamp(sy - r.height - 12, 4, window.innerHeight - r.height - 4) + 'px';
  }

  function hideMenu() {
    pending = null;
    $('actmenu').classList.add('hidden');
    $('buildmenu').classList.add('hidden');
  }

  // ---- İnşa menüsü (kendi toprağına tıklayınca) ----

  function showBuildMenu(sx, sy, cell) {
    pending = { buildCell: cell };
    const m = $('buildmenu');
    for (const type of ['city', 'tower', 'port']) {
      const cost = Game.buildCost(human.id, type);
      $('cost-' + type).textContent = fmt(cost);
      const btn = m.querySelector(`[data-b="${type}"]`);
      let bad = human.balance < cost;
      if (type === 'port' && !Game.nearWater(cell, 2)) bad = true;
      btn.classList.toggle('disabled', bad);
    }
    m.classList.remove('hidden');
    const r = m.getBoundingClientRect();
    m.style.left = clamp(sx - r.width / 2, 4, window.innerWidth - r.width - 4) + 'px';
    m.style.top = clamp(sy - r.height - 12, 4, window.innerHeight - r.height - 4) + 'px';
  }

  document.querySelectorAll('#buildmenu button').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!pending || pending.buildCell === undefined) return;
      const r = Game.build(human.id, pending.buildCell, btn.dataset.b);
      if (r === 'ok') toast('🏗️ İnşa edildi');
      else if (r === 'cash') toast('Yeterli gücün yok');
      else if (r === 'coast') toast('Liman kıyıya kurulmalı');
      else if (r === 'near') toast('Başka bir binaya çok yakın');
      else if (r === 'notown') toast('Burası senin toprağın değil');
      hideMenu();
    }));

  $('act-land').addEventListener('click', () => {
    if (!pending) return;
    const amount = human.balance * attackPct / 100;
    if (amount < 10) { toast('Yeterli gücün yok'); hideMenu(); return; }
    if (pending.target > 0 && Game.hasPact(Game.humanId, pending.target)) {
      Game.breakPact(Game.humanId, pending.target);
      toast('🗡️ İhanet! Bir süre kimse seninle pakt yapmaz');
    }
    if (!Game.launchAttack(human.id, pending.target, amount)) toast('Kara sınırı kalmadı');
    hideMenu();
  });

  const peaceAsked = new Map(); // hedef id -> son teklif döngüsü
  $('act-peace').addEventListener('click', () => {
    if (!pending || pending.target === 0) return;
    const t = pending.target;
    const b = Game.players[t];
    hideMenu();
    if (Game.isTraitor(Game.humanId)) { toast('İhanetinden sonra kimse sana güvenmiyor'); return; }
    if (peaceAsked.has(t) && Game.cycle - peaceAsked.get(t) < 15) { toast(b.name + ' henüz cevap vermek istemiyor'); return; }
    peaceAsked.set(t, Game.cycle);
    toast('🕊️ Teklif ' + b.name + "'e iletildi...");
    setTimeout(() => {
      if (state !== 'play' || b.pixels === 0) return;
      // zayıfsa büyük ihtimalle kabul eder; güçlüyse mizacına bakar
      const accept = b.balance < human.balance * 0.9
        ? Math.random() < 0.75
        : Math.random() < 0.3 / b.aggr;
      if (accept) { Game.makePact(Game.humanId, t); toast('🕊️ ' + b.name + ' barışı kabul etti'); }
      else toast('✗ ' + b.name + ' teklifi reddetti');
    }, 1200);
  });

  // Botlardan gelen barış teklifleri
  function addOffer(botId) {
    if (state !== 'play') return;
    if (document.querySelector(`[data-offer="${botId}"]`)) return;
    if ($('offers').children.length >= 3) return;
    const b = Game.players[botId];
    const div = document.createElement('div');
    div.className = 'offer';
    div.dataset.offer = botId;
    div.innerHTML = `<span class="lbdot" style="background:${b.cssColor}"></span>` +
      `<span>🕊️ ${b.name} barış istiyor</span><button class="ok">✓</button><button class="no">✗</button>`;
    div.querySelector('.ok').onclick = () => {
      Game.makePact(Game.humanId, botId);
      toast('🕊️ ' + b.name + ' ile pakt yapıldı');
      div.remove();
    };
    div.querySelector('.no').onclick = () => div.remove();
    $('offers').appendChild(div);
    setTimeout(() => div.remove(), 15000);
  }

  $('act-sea').addEventListener('click', () => {
    if (!pending) return;
    const amount = human.balance * attackPct / 100;
    const r = Game.launchBoat(human.id, pending.cell, amount);
    if (r === 'ok') toast('⛵ Gemi yola çıktı');
    else if (r === 'weak') toast('Gemi için en az ' + CFG.BOAT_MIN + ' güç gerek');
    else if (r === 'nocoast') toast('Hedefin ulaşılabilir kıyısı yok');
    else if (r === 'noroute') toast('Deniz yolu bulunamadı');
    hideMenu();
  });

  window.addEventListener('keydown', e => { if (e.key === 'Escape') hideMenu(); });

  // Ekran koordinatına yakın gemi (dünya ölçeğinde ~6 hücre yarıçap)
  function findBoatAt(sx, sy) {
    const wx = (sx - Render.ox) / Render.zoom;
    const wy = (sy - Render.oy) / Render.zoom;
    const R = Math.max(4, 12 / Render.zoom);
    let best = null, bd = R * R;
    for (const b of Game.boats) {
      const idx = b.path[Math.min(b.path.length - 1, Math.floor(b.pos))];
      const bx = (idx % Game.W) + 0.5, by = ((idx / Game.W) | 0) + 0.5;
      const d = (bx - wx) * (bx - wx) + (by - wy) * (by - wy);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function showBoatMenu(sx, sy, boat) {
    pending = { boatId: boat.id };
    const m = $('actmenu');
    $('act-land').classList.add('hidden');
    $('act-sea').classList.add('hidden');
    $('act-peace').classList.add('hidden');
    const sk = $('act-sink');
    sk.classList.remove('hidden');
    sk.classList.remove('disabled');
    sk.title = 'Gemiye saldır (' + fmt(boat.troops) + ' asker taşıyor)';
    m.classList.remove('hidden');
    const r = m.getBoundingClientRect();
    m.style.left = clamp(sx - r.width / 2, 4, window.innerWidth - r.width - 4) + 'px';
    m.style.top = clamp(sy - r.height - 12, 4, window.innerHeight - r.height - 4) + 'px';
  }

  $('act-sink').addEventListener('click', () => {
    if (!pending || pending.boatId === undefined) return;
    const res = Game.attackBoat(human.id, pending.boatId, human.balance * attackPct / 100);
    if (res === 'gone') toast('Gemi artık orada değil');
    else if (res === 'weak') toast('Yeterli gücün yok');
    else if (res === 'blocked') toast('Dost gemisine saldıramazsın');
    else if (res.sunk) toast('💥 Düşman gemisi batırıldı! (' + fmt(res.spent) + ' asker harcandı)');
    else toast('⚔️ Muharebe: gemi ' + fmt(res.spent) + ' asker kaybetti, ' + fmt(res.remaining) + ' ile yola devam ediyor');
    hideMenu();
  });

  function nearestLand(i) {
    const W = Game.W, H = Game.H;
    const cx = i % W, cy = (i / W) | 0;
    const R = 14;
    let best = -1, bd = Infinity;
    for (let y = Math.max(0, cy - R); y <= Math.min(H - 1, cy + R); y++) {
      for (let x = Math.max(0, cx - R); x <= Math.min(W - 1, cx + R); x++) {
        const k = y * W + x;
        if (Game.terrain[k] !== 1) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bd) { bd = d; best = k; }
      }
    }
    return best;
  }

  window.addEventListener('resize', () => { Render.resize(); });

  boot('world');
})();
