// Çevrimiçi oda katmanı: PeerJS (WebRTC) üzerinden tarayıcıdan tarayıcıya.
// Model: oda kuran (host) komut sıralayıcıdır — istemcilerin komutlarını toplar,
// tick numarasıyla damgalayıp herkese yayınlar. Simülasyon deterministik olduğu
// için her istemci aynı komutları aynı tickte işleyerek özdeş dünyayı üretir.
// STUN adres bulur; TURN farklı ağlardaki oyuncular doğrudan bağlanamayınca
// (CGNAT / simetrik NAT — ev ve mobil internette çok yaygın) trafiği aktarır.
// TURN olmadan davet linki yalnızca aynı ağdaki oyuncularda çalışır.
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

const Net = {
  active: false,
  isHost: false,
  peer: null,
  conns: [],          // host: tüm bağlantılar; istemci: [hostConn]
  roster: [],         // [{name}] — id = sıra + 1
  mySlot: 0,          // roster indeksim (id = mySlot + 1)
  pendingCmds: [],    // host: bir sonraki tickte yürütülecekler
  batchQueue: new Map(), // istemci: tick -> cmds
  onEvent: null,      // main.js bağlar: (type, data) => {}

  myId() { return this.mySlot + 1; },

  makeCode() {
    const chars = 'ABCDEFGHJKLMNPRSTUVYZ23456789';
    let c = '';
    for (let i = 0; i < 4; i++) c += chars[(Math.random() * chars.length) | 0];
    return c;
  },

  // Sinyal sunucusuyla bağ koparsa (uyku, ağ değişimi) yeniden bağlan;
  // kurulmuş WebRTC bağlantıları bundan etkilenmez.
  keepAlive(peer) {
    peer.on('disconnected', () => {
      if (!peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
    });
  },

  host(name, cb, attempt) {
    attempt = attempt || 0;
    const code = this.makeCode();
    const peer = new Peer('fetih-io-oda-' + code, { config: ICE_CONFIG });
    let settled = false;
    this.peer = peer;
    peer.on('open', () => {
      if (settled) return;
      settled = true;
      this.keepAlive(peer);
      this.active = true; this.isHost = true; this.mySlot = 0;
      this.roster = [{ name }];
      cb(null, code);
    });
    peer.on('error', e => {
      const type = e.type || String(e);
      if (settled) return;
      settled = true;
      // kod başka odada kullanılıyorsa yeni kodla tekrar dene
      if (type === 'unavailable-id' && attempt < 3) {
        peer.destroy();
        this.host(name, cb, attempt + 1);
        return;
      }
      peer.destroy();
      cb(type);
    });
    peer.on('connection', conn => {
      conn.on('open', () => {
        conn.on('data', d => this.hostOnData(conn, d));
        conn.on('close', () => this.emit('peerLeft', { slot: conn._slot }));
      });
      this.conns.push(conn);
    });
  },

  join(code, name, cb) {
    const peer = new Peer({ config: ICE_CONFIG });
    let settled = false;
    const fail = err => {
      if (settled) return;
      settled = true;
      peer.destroy();
      cb(err);
    };
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect('fetih-io-oda-' + code.toUpperCase(), { reliable: true });
      conn.on('open', () => {
        if (settled) return;
        settled = true;
        this.keepAlive(peer);
        this.active = true; this.isHost = false;
        this.conns = [conn];
        conn.on('data', d => this.clientOnData(d));
        conn.on('close', () => this.emit('hostLost', {}));
        conn.send({ t: 'hello', name });
        cb(null);
      });
      conn.on('error', e => fail(e.type || String(e)));
      // TURN üzerinden aktarma gecikebilir — bol süre tanı
      setTimeout(() => fail('timeout'), 20000);
    });
    peer.on('error', e => fail(e.type || String(e)));
  },

  // ---- Host tarafı ----

  lobbyOpen: true,

  hostOnData(conn, d) {
    if (d.t === 'hello') {
      if (!this.lobbyOpen || this.roster.length >= 8) {
        conn.send({ t: 'full' });
        setTimeout(() => conn.close(), 500);
        return;
      }
      conn._slot = this.roster.length;
      this.roster.push({ name: String(d.name || 'Oyuncu').slice(0, 14) });
      conn.send({ t: 'welcome', slot: conn._slot });
      this.emit('rosterChanged', {});
    } else if (d.t === 'lobbycmd') {
      // lobi komutu (spawn): anında herkese sırayla dağıt
      this.emit('lobbyCmd', { pid: conn._slot + 1, cmd: d.cmd });
      this.broadcast({ t: 'lobbycmd', pid: conn._slot + 1, cmd: d.cmd });
    } else if (d.t === 'cmd') {
      this.pendingCmds.push({ pid: conn._slot + 1, cmd: d.cmd });
    }
  },

  broadcast(obj) {
    for (const c of this.conns) { if (c.open) c.send(obj); }
  },

  // host kendi lobi komutunu da aynı yoldan dağıtır
  hostLobbyCmd(cmd) {
    this.emit('lobbyCmd', { pid: this.myId(), cmd });
    this.broadcast({ t: 'lobbycmd', pid: this.myId(), cmd });
  },

  takePending() {
    const c = this.pendingCmds;
    this.pendingCmds = [];
    return c;
  },

  // ---- İstemci tarafı ----

  clientOnData(d) {
    if (d.t === 'welcome') { this.mySlot = d.slot; this.emit('welcome', d); }
    else if (d.t === 'full') this.emit('full', {});
    else if (d.t === 'lobby') this.emit('lobbyState', d);
    else if (d.t === 'lobbycmd') this.emit('lobbyCmd', d);
    else if (d.t === 'start') this.emit('start', d);
    else if (d.t === 'batch') this.batchQueue.set(d.tick, d.cmds);
  },

  // ---- Ortak ----

  sendCmd(cmd) {
    if (!this.active) return;
    if (this.isHost) this.pendingCmds.push({ pid: this.myId(), cmd });
    else if (this.conns[0] && this.conns[0].open) this.conns[0].send({ t: 'cmd', cmd });
  },

  sendLobbyCmd(cmd) {
    if (!this.active) return;
    if (this.isHost) this.hostLobbyCmd(cmd);
    else if (this.conns[0] && this.conns[0].open) this.conns[0].send({ t: 'lobbycmd', cmd });
  },

  emit(type, data) {
    if (this.onEvent) this.onEvent(type, data);
  },
};
