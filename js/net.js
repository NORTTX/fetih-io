// Çevrimiçi oda katmanı: Deno Deploy'daki aktarma sunucusuna WebSocket ile bağlanır.
// Sunucu yalnızca mesaj taşır (oyun mantığı yok). Model: oda kuran (host) komut
// sıralayıcıdır — istemcilerin komutlarını toplar, tick numarasıyla damgalayıp
// herkese yayınlar. Simülasyon deterministik olduğu için her istemci aynı
// komutları aynı tickte işleyerek özdeş dünyayı üretir.
const RELAY_URL =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'ws://' + location.hostname + ':8000'
    : 'wss://fetih-io.norttx.deno.net';

const Net = {
  active: false,
  isHost: false,
  ws: null,
  conns: [],          // host: sahte bağlantılar (cid üzerinden sunucu yönlendirir)
  roster: [],         // [{name}] — id = sıra + 1
  mySlot: 0,          // roster indeksim (id = mySlot + 1)
  pendingCmds: [],    // host: bir sonraki tickte yürütülecekler
  batchQueue: new Map(), // istemci: tick -> cmds
  onEvent: null,      // main.js bağlar: (type, data) => {}
  lobbyOpen: true,

  myId() { return this.mySlot + 1; },

  // Sunucuya bağlan; onReady(ws) ya da onFail(err) bir kez çağrılır.
  open(onReady, onFail) {
    let settled = false;
    let ws;
    try { ws = new WebSocket(RELAY_URL); }
    catch (e) { onFail('network'); return; }
    this.ws = ws;
    ws.onopen = () => { if (!settled) { settled = true; onReady(ws); } };
    ws.onerror = () => { if (!settled) { settled = true; onFail('network'); } };
    ws.onclose = () => {
      if (!settled) { settled = true; onFail('network'); return; }
      // oyun sırasında kopuş: herkes için oda ölmüştür
      if (this.active) { this.active = false; this.emit('hostLost', {}); }
    };
    setTimeout(() => {
      if (!settled) { settled = true; try { ws.close(); } catch (e) {} onFail('timeout'); }
    }, 10000);
    // Sunucu boşta kalan bağlantıyı kapatmasın
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' }));
      else clearInterval(ping);
    }, 25000);
  },

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  },

  toHost(obj) { this.send({ t: 'msg', data: obj }); },

  host(name, cb) {
    let done = false;
    this.open(ws => {
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.t === 'created') {
          if (done) return;
          done = true;
          this.active = true; this.isHost = true; this.mySlot = 0;
          this.roster = [{ name }];
          cb(null, m.code);
        } else if (m.t === 'peer-open') {
          this.conns.push(this.makeConn(m.cid));
        } else if (m.t === 'msg') {
          const conn = this.conns.find(c => c.cid === m.from);
          if (conn) this.hostOnData(conn, m.data);
        } else if (m.t === 'peer-close') {
          const conn = this.conns.find(c => c.cid === m.cid);
          if (conn) { conn.open = false; this.emit('peerLeft', { slot: conn._slot }); }
        }
      };
      this.send({ t: 'create' });
      setTimeout(() => { if (!done) { done = true; cb('timeout'); } }, 8000);
    }, err => { if (!done) { done = true; cb(err); } });
  },

  // host tarafında her misafir için sahte bağlantı nesnesi
  makeConn(cid) {
    const self = this;
    return {
      cid,
      open: true,
      _slot: undefined,
      send(obj) { self.send({ t: 'msg', to: cid, data: obj }); },
      close() { self.send({ t: 'kick', cid }); },
    };
  },

  join(code, name, cb) {
    let done = false;
    this.open(ws => {
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.t === 'joined') {
          if (done) return;
          done = true;
          this.active = true; this.isHost = false;
          this.toHost({ t: 'hello', name });
          cb(null);
        } else if (m.t === 'no-room') {
          if (!done) { done = true; cb('no-room'); }
          try { ws.close(); } catch (e) {}
        } else if (m.t === 'msg') {
          this.clientOnData(m.data);
        } else if (m.t === 'host-close') {
          // onclose 'hostLost' üretir
          try { ws.close(); } catch (e) {}
        }
      };
      this.send({ t: 'join', code: code.toUpperCase() });
      setTimeout(() => { if (!done) { done = true; cb('timeout'); } }, 8000);
    }, err => { if (!done) { done = true; cb(err); } });
  },

  // ---- Host tarafı ----

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

  // tek mesaj: sunucu tüm misafirlere dağıtır
  broadcast(obj) {
    this.send({ t: 'msg', to: 'all', data: obj });
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
    else this.toHost({ t: 'cmd', cmd });
  },

  sendLobbyCmd(cmd) {
    if (!this.active) return;
    if (this.isHost) this.hostLobbyCmd(cmd);
    else this.toHost({ t: 'lobbycmd', cmd });
  },

  emit(type, data) {
    if (this.onEvent) this.onEvent(type, data);
  },
};
