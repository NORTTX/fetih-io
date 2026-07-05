// Çevrimiçi oda katmanı: PeerJS (WebRTC) üzerinden tarayıcıdan tarayıcıya.
// Model: oda kuran (host) komut sıralayıcıdır — istemcilerin komutlarını toplar,
// tick numarasıyla damgalayıp herkese yayınlar. Simülasyon deterministik olduğu
// için her istemci aynı komutları aynı tickte işleyerek özdeş dünyayı üretir.
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

  host(name, cb) {
    const code = this.makeCode();
    this.peer = new Peer('fetih-io-oda-' + code);
    this.peer.on('open', () => {
      this.active = true; this.isHost = true; this.mySlot = 0;
      this.roster = [{ name }];
      cb(null, code);
    });
    this.peer.on('error', e => cb(e.type || String(e)));
    this.peer.on('connection', conn => {
      conn.on('open', () => {
        conn.on('data', d => this.hostOnData(conn, d));
        conn.on('close', () => this.emit('peerLeft', { slot: conn._slot }));
      });
      this.conns.push(conn);
    });
  },

  join(code, name, cb) {
    this.peer = new Peer();
    this.peer.on('open', () => {
      const conn = this.peer.connect('fetih-io-oda-' + code.toUpperCase(), { reliable: true });
      let ok = false;
      conn.on('open', () => {
        this.active = true; this.isHost = false;
        this.conns = [conn];
        conn.on('data', d => this.clientOnData(d));
        conn.on('close', () => this.emit('hostLost', {}));
        conn.send({ t: 'hello', name });
        ok = true; cb(null);
      });
      conn.on('error', e => { if (!ok) cb(String(e)); });
      setTimeout(() => { if (!ok) cb('timeout'); }, 8000);
    });
    this.peer.on('error', e => cb(e.type || String(e)));
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
