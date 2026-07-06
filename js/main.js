// Ana döngü, girişler, arayüz ve çevrimiçi oda akışı
(() => {
  const BOT_NAMES = [
    'Roma', 'Osmanlı', 'Pers', 'Kartaca', 'Vikingler', 'Moğollar', 'Prusya',
    'Babil', 'Aztek', 'İnka', 'Mısır', 'Sparta', 'Atina', 'Hitit', 'Asur',
    'Galya', 'Keltler', 'Frigya', 'Lidya', 'Nubya', 'Fenike', 'Makedonya',
    'Hunlar', 'Bizans', 'Songhay', 'Maya', 'Kuşan', 'Elam', 'Urartu', 'Timurlular',
  ];
  const HUMAN_COLORS = [
    { r: 240, g: 200, b: 60 }, { r: 220, g: 70, b: 60 }, { r: 70, g: 130, b: 235 },
    { r: 80, g: 200, b: 100 }, { r: 190, g: 90, b: 220 }, { r: 245, g: 140, b: 40 },
    { r: 60, g: 200, b: 210 }, { r: 235, g: 110, b: 170 },
  ];

  const canvas = document.getElementById('canvas');
  const $ = id => document.getElementById(id);

  let state = 'pick'; // pick | lobby | play | over
  let attackPct = 25;
  let map = null;
  let human = null;
  let mapType = 'world';
  let booted = false;
  const settings = { players: 27, teams: 0 };
  const TEAM_HUES = [45, 210, 0, 130];

  // çevrimiçi durum
  let online = false;
  let lobbyDeadline = 0;   // host: gerçek zaman; istemci: tahmini
  let humanSpots = [];     // lobide seçilen insan doğum noktaları [[x,y],...]
  let mySpawned = false;
  let gameStarted = false;

  // ---- Kurulum ----

  const MAP_MASKS = { world: () => WORLD_MASK, europe: () => EUROPE_MASK, med: () => MED_MASK };
  const MAP_TEMPLATES = { random: 'continent', arch: 'arch', duo: 'duo' };

  function buildMap(type, seed) {
    if (MAP_MASKS[type]) {
      const mask = MAP_MASKS[type]();
      CFG.MAP_W = mask.w;
      CFG.MAP_H = mask.h;
      return MapGen.fromMask(mask);
    }
    CFG.MAP_W = 960;
    CFG.MAP_H = 600;
    return MapGen.generate(seed, MAP_TEMPLATES[type]);
  }

  function boot(type, seed) {
    mapType = type;
    if (seed === undefined) seed = (Math.random() * 1e9) | 0;
    map = buildMap(type, seed);
    Game.init(map, seed);
    bindCallbacks();
    if (!online) {
      human = addHuman(0, myName());
      Game.humanId = 1;
    }
    Render.init(canvas, map);
    document.querySelectorAll('#mapselect button').forEach(b =>
      b.classList.toggle('active', b.dataset.m === type));
    if (!booted) { booted = true; requestAnimationFrame(frame); }
  }

  function addHuman(slot, name) {
    let col;
    if (settings.teams > 0) {
      const team = (slot % settings.teams) + 1;
      col = hslToRgb(TEAM_HUES[(team - 1) % TEAM_HUES.length], 62, 44 + (slot % 3) * 8);
      const p = Game.addPlayer(name, col, false);
      p.team = team;
      return p;
    }
    col = HUMAN_COLORS[slot % HUMAN_COLORS.length];
    return Game.addPlayer(name, col, false);
  }

  function bindCallbacks() {
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
    Game.onPeaceResult = (fromId, targetId, accept) => {
      if (fromId === Game.humanId) {
        toast(accept ? '🕊️ ' + Game.players[targetId].name + ' barışı kabul etti'
                     : '✗ ' + Game.players[targetId].name + ' teklifi reddetti');
      } else if (targetId === Game.humanId && accept) {
        toast('🕊️ ' + Game.players[fromId].name + ' ile pakt yapıldı');
      }
    };
    Game.onHumanPeaceOffer = (fromId, toId) => {
      if (toId === Game.humanId) addOffer(fromId);
    };
    Bots.onOffer = (botId, humanId) => {
      if (humanId === Game.humanId) addOffer(botId);
    };
    $('offers').innerHTML = '';
  }

  function myName() {
    const v = $('name-input') ? $('name-input').value.trim() : '';
    return (v || 'Oyuncu').slice(0, 14);
  }

  // ---- Komut yolu: solo anında, online host üzerinden ----

  function issue(cmd) {
    if (online) Net.sendCmd(cmd);
    else Game.execCommand(Game.humanId, cmd);
  }

  // ---- Menü / ayar arayüzü ----

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

  // ---- Çevrimiçi oda ----

  function netAvailable() { return typeof Peer !== 'undefined'; }

  const NET_ERRORS = {
    'peer-unavailable': 'Oda bulunamadı — kod yanlış ya da oda kapanmış',
    'timeout': 'Bağlantı kurulamadı — oda kurucusu çevrimdışı olabilir, tekrar dene',
    'network': 'Sunucuya ulaşılamadı — internetini kontrol et',
    'browser-incompatible': 'Tarayıcın WebRTC desteklemiyor',
    'unavailable-id': 'Oda kodu alınamadı — tekrar dene',
  };
  function netErrMsg(err) { return NET_ERRORS[err] || ('Bağlantı hatası: ' + err); }

  $('btn-host').addEventListener('click', () => {
    if (state !== 'pick') return;
    if (!netAvailable()) { toast('Çevrimiçi mod yüklenemedi (internet?)'); return; }
    $('btn-host').disabled = true;
    Net.onEvent = onNetEvent;
    Net.host(myName(), (err, code) => {
      $('btn-host').disabled = false;
      if (err) { toast('Oda kurulamadı: ' + netErrMsg(err)); return; }
      online = true;
      const seed = (Math.random() * 1e9) | 0;
      enterLobbyAsHost(code, seed);
    });
  });

  $('btn-join').addEventListener('click', () => {
    if (state !== 'pick') return;
    if (!netAvailable()) { toast('Çevrimiçi mod yüklenemedi (internet?)'); return; }
    const code = $('code-input').value.trim().toUpperCase();
    if (code.length !== 4) { toast('4 harfli oda kodunu gir'); return; }
    $('btn-join').disabled = true;
    Net.onEvent = onNetEvent;
    Net.join(code, myName(), err => {
      $('btn-join').disabled = false;
      if (err) { toast('Katılamadın: ' + netErrMsg(err)); return; }
      online = true;
      toast('Odaya bağlanıldı, harita bekleniyor...');
    });
  });

  let hostState = null; // host: {code, seed, spawns:[{pid,x,y}]}

  function enterLobbyAsHost(code, seed) {
    hostState = { code, seed, spawns: [] };
    Game.humanId = 1;
    boot(mapType, seed);
    human = addHuman(0, Net.roster[0].name);
    state = 'lobby';
    lobbyDeadline = Date.now() + 30000;
    showLobbyUI(code);
    // lobi durumunu periyodik yayınla
    hostState.timer = setInterval(() => {
      if (state !== 'lobby') { clearInterval(hostState.timer); return; }
      Net.broadcast(lobbyMsg());
      if (Date.now() >= lobbyDeadline) hostStartGame();
    }, 800);
  }

  function lobbyMsg() {
    return {
      t: 'lobby',
      code: hostState.code,
      seed: hostState.seed,
      mapType, settings,
      roster: Net.roster,
      spawns: hostState.spawns,
      secondsLeft: Math.max(0, Math.ceil((lobbyDeadline - Date.now()) / 1000)),
    };
  }

  function hostStartGame() {
    clearInterval(hostState.timer);
    // doğum yeri seçmeyenlere rastgele yer ata (açık koordinat yayınlanır)
    for (let slot = 0; slot < Net.roster.length; slot++) {
      const pid = slot + 1;
      if (Game.players[pid] && Game.players[pid].pixels > 0) continue;
      for (let t = 0; t < 2000; t++) {
        const i = (Math.random() * Game.W * Game.H) | 0;
        if (Game.spawnable[i] !== 1 || Game.owner[i] !== 0) continue;
        const cmd = { type: 'spawn', x: i % Game.W, y: (i / Game.W) | 0 };
        applyLobbyCmd(pid, cmd);
        Net.broadcast({ t: 'lobbycmd', pid, cmd });
        break;
      }
    }
    Net.lobbyOpen = false;
    Net.broadcast({ t: 'start' });
    startOnlineGame();
  }

  function onNetEvent(type, d) {
    if (type === 'rosterChanged') {
      // host: yeni oyuncuları ekle
      while (Game.players.length - 1 < Net.roster.length) {
        addHuman(Game.players.length - 1, Net.roster[Game.players.length - 1].name);
      }
      // yeni katılan doğum yeri seçebilsin diye geri sayım 30 sn'ye kurulur
      lobbyDeadline = Date.now() + 30000;
      toast('🎮 ' + Net.roster[Net.roster.length - 1].name + ' odaya katıldı');
      updateLobbyPlayers();
      Net.broadcast(lobbyMsg());
    } else if (type === 'lobbyState') {
      // istemci: ilk mesajda haritayı kur, sonra kadroyu eşitle
      if (state === 'pick') {
        Object.assign(settings, d.settings);
        Game.humanId = Net.myId();
        boot(d.mapType, d.seed);
        state = 'lobby';
        showLobbyUI(d.code);
      }
      while (Game.players.length - 1 < d.roster.length) {
        addHuman(Game.players.length - 1, d.roster[Game.players.length - 1].name);
      }
      Net.roster = d.roster;
      human = Game.players[Net.myId()];
      // kaçırılan spawn'ları uygula (humanSpots ve hazır işaretleri de güncellenir)
      for (const s of d.spawns) {
        applyLobbyCmd(s.pid, { type: 'spawn', x: s.x, y: s.y });
      }
      lobbyDeadline = Date.now() + d.secondsLeft * 1000;
      updateLobbyPlayers();
    } else if (type === 'lobbyCmd') {
      applyLobbyCmd(d.pid, d.cmd);
      if (Net.isHost) hostState.spawns.push({ pid: d.pid, x: d.cmd.x, y: d.cmd.y });
    } else if (type === 'start') {
      startOnlineGame();
    } else if (type === 'peerLeft') {
      const p = Game.players[d.slot + 1];
      if (p) toast('👋 ' + p.name + ' ayrıldı');
    } else if (type === 'hostLost') {
      if (state === 'play' || state === 'lobby') {
        endGame(false, 'Oda kurucusunun bağlantısı koptu.');
      }
    } else if (type === 'full') {
      toast('Oda dolu veya oyun çoktan başladı');
    }
  }

  function applyLobbyCmd(pid, cmd) {
    if (cmd.type !== 'spawn') return;
    const p = Game.players[pid];
    if (!p || p.pixels > 0) return;
    Game.execCommand(pid, { type: 'spawn', x: cmd.x, y: cmd.y });
    humanSpots.push([cmd.x, cmd.y]);
    if (pid === Game.humanId) mySpawned = true;
    updateLobbyPlayers();
  }

  function showLobbyUI(code) {
    $('banner').classList.add('hidden');
    $('mapselect').classList.add('hidden');
    $('settings').classList.add('hidden');
    $('online').classList.add('hidden');
    $('lobbypanel').classList.remove('hidden');
    $('lobby-code').textContent = code;
    const link = location.origin + location.pathname + '?room=' + code;
    $('lobby-link').value = link;
    $('btn-start-now').classList.toggle('hidden', !Net.isHost);
    updateLobbyPlayers();
  }

  function updateLobbyPlayers() {
    if (state !== 'lobby') return;
    let html = '';
    for (let slot = 0; slot < Net.roster.length; slot++) {
      const p = Game.players[slot + 1];
      const ready = p && p.pixels > 0 ? ' ✓' : ' …';
      const col = p ? p.cssColor : '#888';
      html += `<div class="lbrow"><span class="lbdot" style="background:${col}"></span>` +
              `<span class="lbname">${Net.roster[slot].name}${ready}</span></div>`;
    }
    $('lobby-players').innerHTML = html;
  }

  $('btn-copy').addEventListener('click', () => {
    $('lobby-link').select();
    try { document.execCommand('copy'); toast('Link kopyalandı'); } catch (e) {}
    if (navigator.clipboard) navigator.clipboard.writeText($('lobby-link').value).catch(() => {});
  });

  $('btn-start-now').addEventListener('click', () => {
    if (Net.isHost && state === 'lobby') hostStartGame();
  });

  function startOnlineGame() {
    if (gameStarted) return;
    gameStarted = true;
    human = Game.players[Game.humanId];
    // botlar: deterministik (paylaşılan rng) → her istemcide birebir aynı
    const botCount = clamp(settings.players - Net.roster.length, 0, 60);
    spawnBots(humanSpots, botCount, Net.roster.length);
    state = 'play';
    $('lobbypanel').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('lb').classList.remove('hidden');
    $('piepanel').classList.remove('hidden');
    $('bottom').classList.remove('hidden');
    lastTime = performance.now();
    acc = 0;
  }

  // ---- Solo başlangıç ----

  function startGame(cx, cy) {
    if (settings.teams > 0) human.team = 1;
    Game.spawn(human, cx, cy);
    spawnBots([[cx, cy]], clamp(settings.players - 1, 1, 60), 1);
    state = 'play';
    $('banner').classList.add('hidden');
    $('mapselect').classList.add('hidden');
    $('settings').classList.add('hidden');
    $('online').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('lb').classList.remove('hidden');
    $('piepanel').classList.remove('hidden');
    $('bottom').classList.remove('hidden');
    lastTime = performance.now();
  }

  // Deterministik bot yerleştirme (Game.rng): online modda tüm istemciler aynı
  function spawnBots(spots, botCount, humanCount) {
    const { W, H } = Game;
    const names = BOT_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) {
      const j = (Game.rng() * (i + 1)) | 0;
      [names[i], names[j]] = [names[j], names[i]];
    }
    const allSpots = spots.slice();
    let placed = 0;
    for (let b = 0; b < botCount; b++) {
      let found = null;
      for (let t = 0; t < 800; t++) {
        const i = (Game.rng() * W * H) | 0;
        if (Game.spawnable[i] !== 1 || Game.owner[i] !== 0) continue;
        const x = i % W, y = (i / W) | 0;
        let ok = true;
        for (const [sx, sy] of allSpots) {
          const dx = x - sx, dy = y - sy;
          if (dx * dx + dy * dy < CFG.MIN_SPAWN_DIST * CFG.MIN_SPAWN_DIST) { ok = false; break; }
        }
        if (ok) { found = [x, y]; break; }
      }
      if (!found) continue;
      allSpots.push(found);
      const team = settings.teams > 0 ? ((b + humanCount) % settings.teams) + 1 : 0;
      let col;
      if (settings.teams > 0) {
        const hue = TEAM_HUES[(team - 1) % TEAM_HUES.length];
        const member = ((b + humanCount) / settings.teams) | 0;
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

  function stepTick() {
    if (online && Net.isHost) {
      const cmds = Net.takePending();
      Net.broadcast({ t: 'batch', tick: Game.tick + 1, cmds });
      for (const c of cmds) Game.execCommand(c.pid, c.cmd);
    }
    Game.processTick();
    Bots.tick();
    if (Game.tick % CFG.TICKS_PER_CYCLE === 0) checkEnd();
  }

  function frame(now) {
    if (state === 'play') {
      if (!online || Net.isHost) {
        acc += now - lastTime;
        lastTime = now;
        let guard = 0;
        while (acc >= CFG.TICK_MS && guard++ < 24) {
          stepTick();
          acc -= CFG.TICK_MS;
        }
        if (acc > CFG.TICK_MS * 4) acc = CFG.TICK_MS * 4;
      } else {
        // istemci: host'un damgaladığı tick paketlerini sırayla işle
        lastTime = now;
        let guard = 0;
        while (guard++ < 40) {
          const cmds = Net.batchQueue.get(Game.tick + 1);
          if (cmds === undefined) break;
          Net.batchQueue.delete(Game.tick + 1);
          for (const c of cmds) Game.execCommand(c.pid, c.cmd);
          Game.processTick();
          Bots.tick();
          if (Game.tick % CFG.TICKS_PER_CYCLE === 0) checkEnd();
        }
      }
      if (now - hudTimer > 150) { hudTimer = now; updateHUD(); updateLeaderboard(); }
    } else {
      lastTime = now;
      if (state === 'lobby' && now - hudTimer > 300) {
        hudTimer = now;
        const s = Math.max(0, Math.ceil((lobbyDeadline - Date.now()) / 1000));
        $('lobby-count').textContent = s;
      }
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

  // ---- HUD ----

  function updateHUD() {
    const effPix = human.pixels + CFG.CITY_CAP_BONUS * human.bCount.city;
    const fullB = CFG.FULL_INCOME_MULT * effPix;
    const maxB = CFG.MAX_BALANCE_MULT * effPix;
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
    $('attacklist').classList.toggle('hidden', ah === '' || state !== 'play');
  }

  $('attacklist').addEventListener('click', e => {
    const el = e.target;
    if (el.dataset.key !== undefined) {
      issue({ type: 'cancel', key: el.dataset.key });
      toast('Saldırı iptal ediliyor...');
    } else if (el.dataset.boat !== undefined) {
      issue({ type: 'recall', boatId: +el.dataset.boat });
      toast('⛵ Gemi geri çağrılıyor...');
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
      for (let k = 0; k < rows.length && k < 12; k++) {
        slices.push({ frac: rows[k].pixels / total, css: rows[k].cssColor });
      }
      const rest = rows.slice(12).reduce((s, p) => s + p.pixels, 0);
      if (rest > 0) slices.push({ frac: rest / total, css: '#7a828c' });
    }
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
    else if (e.key === 'Escape') hideMenu();
  });

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 2000);
  }

  // ---- Saldırı seçim menüsü (⚔️/⛵/🤝/💥) ----

  let pending = null;

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
    pb.classList.remove('hidden');
    pb.textContent = pact ? '🕊️' : '🤝';
    pb.title = pact ? 'Pakt zaten var' : 'Barış teklif et';
    pb.classList.toggle('hidden', target === 0);
    pb.classList.toggle('disabled', target === 0 || pact || Game.isTraitor(Game.humanId));
    m.classList.remove('hidden');
    placeMenu(m, sx, sy);
  }

  function placeMenu(m, sx, sy) {
    const r = m.getBoundingClientRect();
    m.style.left = clamp(sx - r.width / 2, 4, window.innerWidth - r.width - 4) + 'px';
    m.style.top = clamp(sy - r.height - 12, 4, window.innerHeight - r.height - 4) + 'px';
  }

  function hideMenu() {
    pending = null;
    $('actmenu').classList.add('hidden');
    $('buildmenu').classList.add('hidden');
  }

  $('act-land').addEventListener('click', () => {
    if (!pending) return;
    const amount = human.balance * attackPct / 100;
    if (amount < 10) { toast('Yeterli gücün yok'); hideMenu(); return; }
    if (pending.target > 0 && Game.hasPact(Game.humanId, pending.target)) {
      issue({ type: 'betray', target: pending.target, pct: attackPct });
      toast('🗡️ İhanet! Bir süre kimse seninle pakt yapmaz');
    } else {
      issue({ type: 'attack', target: pending.target, pct: attackPct });
    }
    hideMenu();
  });

  $('act-sea').addEventListener('click', () => {
    if (!pending) return;
    const amount = human.balance * attackPct / 100;
    if (amount < CFG.BOAT_MIN) { toast('Gemi için en az ' + CFG.BOAT_MIN + ' güç gerek'); hideMenu(); return; }
    issue({ type: 'boat', cell: pending.cell, pct: attackPct });
    toast('⛵ Gemi yola çıkıyor');
    hideMenu();
  });

  const peaceAsked = new Map();
  $('act-peace').addEventListener('click', () => {
    if (!pending || pending.target === 0) return;
    const t = pending.target;
    const b = Game.players[t];
    hideMenu();
    if (Game.isTraitor(Game.humanId)) { toast('İhanetinden sonra kimse sana güvenmiyor'); return; }
    if (peaceAsked.has(t) && Game.cycle - peaceAsked.get(t) < 15) { toast(b.name + ' henüz cevap vermek istemiyor'); return; }
    peaceAsked.set(t, Game.cycle);
    toast('🕊️ Teklif ' + b.name + "'e iletildi...");
    issue({ type: 'peace', target: t });
  });

  $('act-sink').addEventListener('click', () => {
    if (!pending || pending.boatId === undefined) return;
    const amount = human.balance * attackPct / 100;
    if (amount < 10) { toast('Yeterli gücün yok'); hideMenu(); return; }
    issue({ type: 'sink', boatId: pending.boatId, pct: attackPct });
    toast('⚔️ Donanma muharebeye gidiyor');
    hideMenu();
  });

  // Botlardan / insanlardan gelen barış teklifleri
  function addOffer(fromId) {
    if (state !== 'play') return;
    if (document.querySelector(`[data-offer="${fromId}"]`)) return;
    if ($('offers').children.length >= 3) return;
    const b = Game.players[fromId];
    const div = document.createElement('div');
    div.className = 'offer';
    div.dataset.offer = fromId;
    div.innerHTML = `<span class="lbdot" style="background:${b.cssColor}"></span>` +
      `<span>🕊️ ${b.name} barış istiyor</span><button class="ok">✓</button><button class="no">✗</button>`;
    div.querySelector('.ok').onclick = () => {
      issue({ type: 'acceptPact', target: fromId });
      div.remove();
    };
    div.querySelector('.no').onclick = () => div.remove();
    $('offers').appendChild(div);
    setTimeout(() => div.remove(), 15000);
  }

  // ---- İnşa menüsü ----

  function showBuildMenu(sx, sy, cell) {
    pending = { buildCell: cell };
    const m = $('buildmenu');
    for (const type of ['city', 'tower', 'port']) {
      const cost = Game.buildCost(Game.humanId, type);
      $('cost-' + type).textContent = fmt(cost);
      const btn = m.querySelector(`[data-b="${type}"]`);
      let bad = human.balance < cost;
      if (type === 'port' && !Game.nearWater(cell, 2)) bad = true;
      btn.classList.toggle('disabled', bad);
    }
    m.classList.remove('hidden');
    placeMenu(m, sx, sy);
  }

  document.querySelectorAll('#buildmenu button').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!pending || pending.buildCell === undefined) return;
      issue({ type: 'build', cell: pending.buildCell, kind: btn.dataset.b });
      toast('🏗️ İnşa ediliyor');
      hideMenu();
    }));

  // ---- Fare ----

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
      else handleClick(e.clientX, e.clientY);
      return;
    }
    if (panning) return;
    if (e.button !== 0) return;
    handleClick(e.clientX, e.clientY);
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    hideMenu();
    Render.zoomAt(e.clientX, e.clientY, Math.pow(1.1, -e.deltaY / 100));
  }, { passive: false });

  function handleAimRelease(sx, sy) {
    let i = Render.screenToCell(sx, sy);
    if (i < 0) return;
    if (Game.terrain[i] !== 1) {
      const n = nearestLand(i);
      if (n < 0) { toast('Açık deniz'); return; }
      i = n;
    }
    const t = Game.owner[i];
    if (t === Game.humanId) return;
    if (t > 0 && Game.allied(Game.humanId, t)) { toast('Müttefik toprağına saldıramazsın'); return; }
    if (t > 0 && Game.hasPact(Game.humanId, t)) { toast('🕊️ Pakt var — bozmak için menüden 🗡️ kullan'); return; }
    const amount = human.balance * attackPct / 100;
    if (amount < 10) { toast('Yeterli gücün yok'); return; }
    if (Game.canLandAttack(Game.humanId, t)) {
      issue({ type: 'attack', target: t, pct: attackPct, dir: i });
    } else if (Game.canSeaAttack(Game.humanId, i)) {
      if (amount < CFG.BOAT_MIN) { toast('Gemi için en az ' + CFG.BOAT_MIN + ' güç gerek'); return; }
      issue({ type: 'boat', cell: i, pct: attackPct });
      toast('⛵ Gemi yola çıkıyor');
    } else {
      toast('Bu hedefe ne karadan ne denizden ulaşılabiliyor');
    }
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
    placeMenu(m, sx, sy);
  }

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

  function handleClick(sx, sy) {
    let i = Render.screenToCell(sx, sy);
    if (i < 0) return;

    if (state === 'pick') {
      if (Game.spawnable[i] !== 1) { toast('Bir kıtada yer seç (çok küçük adalar olmaz)'); return; }
      startGame(i % Game.W, (i / Game.W) | 0);
      return;
    }
    if (state === 'lobby') {
      if (mySpawned) { toast('Doğum yerini zaten seçtin'); return; }
      if (Game.spawnable[i] !== 1 || Game.owner[i] !== 0) { toast('Boş bir kıta noktası seç'); return; }
      Net.sendLobbyCmd({ type: 'spawn', x: i % Game.W, y: (i / Game.W) | 0 });
      return;
    }
    if (state !== 'play' || human.pixels === 0) return;

    const boat = findBoatAt(sx, sy);
    if (boat) {
      if (boat.from === Game.humanId) { toast('Kendi gemin — geri çağırmak için listedeki ↩'); return; }
      if (Game.allied(Game.humanId, boat.from) || Game.hasPact(Game.humanId, boat.from)) { toast('Dost gemisi'); return; }
      showBoatMenu(sx, sy, boat);
      return;
    }

    if (Game.terrain[i] !== 1) {
      const n = nearestLand(i);
      if (n < 0) { hideMenu(); toast('Açık deniz — bir kıyıya tıkla'); return; }
      i = n;
    }
    const target = Game.owner[i];
    if (target === Game.humanId) { hideMenu(); showBuildMenu(sx, sy, i); return; }
    if (target > 0 && Game.allied(Game.humanId, target)) { hideMenu(); toast('Müttefik toprağı'); return; }

    const canLand = Game.canLandAttack(Game.humanId, target);
    const canSea = Game.canSeaAttack(Game.humanId, i);
    if (!canLand && !canSea) { hideMenu(); toast('Bu hedefe ne karadan ne denizden ulaşılabiliyor'); return; }
    showMenu(sx, sy, i, target, canLand, canSea);
  }

  window.addEventListener('resize', () => { Render.resize(); });

  // ---- Başlat ----

  const roomParam = new URLSearchParams(location.search).get('room');
  boot('world');
  if (roomParam && netAvailable()) {
    $('code-input').value = roomParam.toUpperCase();
    toast('Odaya bağlanılıyor: ' + roomParam.toUpperCase());
    setTimeout(() => $('btn-join').click(), 400);
  }
})();
