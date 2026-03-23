import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3001", 10);

// roomId → Map<peerId, { ws, displayName, micOn, camOn }>
const rooms = new Map();

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    return;
  }

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server });

function broadcast(roomId, excludePeerId, msg) {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const [pid, peer] of room) {
    if (pid !== excludePeerId) peer.ws.send(data);
  }
}

wss.on("connection", (ws) => {
  let peerId = null;
  let roomId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case "join": {
        roomId = msg.roomId;
        peerId = msg.peerId;
        const displayName = msg.displayName || "Guest";

        if (!rooms.has(roomId)) rooms.set(roomId, new Map());
        const room = rooms.get(roomId);

        const existing = [];
        for (const [pid, peer] of room) {
          existing.push({ peerId: pid, displayName: peer.displayName, micOn: peer.micOn, camOn: peer.camOn });
        }
        ws.send(JSON.stringify({ type: "room-peers", peers: existing }));

        room.set(peerId, { ws, displayName, micOn: true, camOn: true });

        broadcast(roomId, peerId, { type: "peer-joined", peerId, displayName });
        console.log(`[${roomId}] ${displayName} (${peerId}) joined — ${room.size} peers`);
        break;
      }

      case "offer":
      case "answer":
      case "ice-candidate": {
        const target = rooms.get(roomId)?.get(msg.to);
        if (target) {
          target.ws.send(JSON.stringify({ ...msg, from: peerId }));
        }
        break;
      }

      case "chat": {
        const room = rooms.get(roomId);
        const sender = room?.get(peerId);
        if (!sender) break;
        broadcast(roomId, peerId, {
          type: "chat",
          from: peerId,
          displayName: sender.displayName,
          body: msg.body,
          ts: Date.now(),
        });
        break;
      }

      case "media-state": {
        const room = rooms.get(roomId);
        const peer = room?.get(peerId);
        if (!peer) break;
        if (msg.micOn !== undefined) peer.micOn = msg.micOn;
        if (msg.camOn !== undefined) peer.camOn = msg.camOn;
        broadcast(roomId, peerId, {
          type: "media-state",
          peerId,
          micOn: peer.micOn,
          camOn: peer.camOn,
        });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (!roomId || !peerId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    room.delete(peerId);
    console.log(`[${roomId}] ${peerId} left — ${room.size} peers`);

    broadcast(roomId, null, { type: "peer-left", peerId });

    if (room.size === 0) rooms.delete(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
