// Fetih.io aktarma sunucusu (Deno Deploy)
// Oyun mantığı içermez: odaları tutar ve mesajları taşır. Host komut
// sıralayıcıdır; sunucu hostun paketlerini misafirlere, misafirlerinkini
// hosta iletir. Böylece NAT/TURN derdi olmaz — herkes sunucuya bağlanır.

type Room = {
  code: string;
  host: WebSocket;
  guests: Map<number, WebSocket>; // cid -> soket
  nextCid: number;
};

const rooms = new Map<string, Room>();
const CHARS = 'ABCDEFGHJKLMNPRSTUVYZ23456789';

function makeCode(): string {
  for (let t = 0; t < 50; t++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CHARS[(Math.random() * CHARS.length) | 0];
    if (!rooms.has(c)) return c;
  }
  return 'X' + Date.now().toString(36).slice(-3).toUpperCase();
}

function send(ws: WebSocket, obj: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

Deno.serve((req: Request) => {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Fetih.io relay calisiyor. Oda sayisi: ' + rooms.size);
  }
  const { socket, response } = Deno.upgradeWebSocket(req);

  let room: Room | null = null;
  let cid = 0; // 0 = host

  socket.onmessage = (e) => {
    let m: any;
    try { m = JSON.parse(String(e.data)); } catch { return; }

    if (m.t === 'ping') {
      send(socket, { t: 'pong' });

    } else if (m.t === 'create' && !room) {
      const code = makeCode();
      room = { code, host: socket, guests: new Map(), nextCid: 1 };
      rooms.set(code, room);
      send(socket, { t: 'created', code });

    } else if (m.t === 'join' && !room) {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r || r.host.readyState !== WebSocket.OPEN || r.guests.size >= 16) {
        send(socket, { t: 'no-room' });
        return;
      }
      room = r;
      cid = r.nextCid++;
      r.guests.set(cid, socket);
      send(socket, { t: 'joined' });
      send(r.host, { t: 'peer-open', cid });

    } else if (m.t === 'msg' && room) {
      if (cid === 0) {
        // host -> misafir(ler)
        if (m.to === 'all') {
          const s = JSON.stringify({ t: 'msg', data: m.data });
          for (const g of room.guests.values()) {
            if (g.readyState === WebSocket.OPEN) g.send(s);
          }
        } else {
          const g = room.guests.get(m.to);
          if (g) send(g, { t: 'msg', data: m.data });
        }
      } else {
        // misafir -> host
        send(room.host, { t: 'msg', from: cid, data: m.data });
      }

    } else if (m.t === 'kick' && room && cid === 0) {
      const g = room.guests.get(m.cid);
      if (g) { room.guests.delete(m.cid); try { g.close(); } catch { /* */ } }
    }
  };

  socket.onclose = () => {
    if (!room) return;
    if (cid === 0) {
      // host gitti: oda kapanır, misafirlere haber verilir
      for (const g of room.guests.values()) {
        send(g, { t: 'host-close' });
        try { g.close(); } catch { /* */ }
      }
      rooms.delete(room.code);
    } else {
      room.guests.delete(cid);
      send(room.host, { t: 'peer-close', cid });
    }
  };

  return response;
});
