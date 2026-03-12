const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// State
const rooms = {}; // { code: { host, guests: [], notifications: [] } }

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// Broadcast to all clients in a room
function broadcast(code, data, excludeWs = null) {
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.roomCode === code && client !== excludeWs) {
      client.send(JSON.stringify(data));
    }
  });
}

// Send to specific client
function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;
  ws.name = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // المقدم يفتح جلسة
      case 'create_room': {
        const code = String(Math.floor(1000 + Math.random() * 9000));
        rooms[code] = { host: ws, guests: [], notifications: [] };
        ws.roomCode = code;
        ws.role = 'host';
        send(ws, { type: 'room_created', code });
        break;
      }

      // مشارك يدخل
      case 'join_room': {
        const { code, name } = msg;
        if (!rooms[code]) { send(ws, { type: 'error', msg: 'الكود غير صحيح' }); return; }
        if (rooms[code].guests.length >= 2) { send(ws, { type: 'error', msg: 'الغرفة ممتلئة' }); return; }
        if (rooms[code].guests.find(g => g.name === name)) { send(ws, { type: 'error', msg: 'الاسم مستخدم' }); return; }

        ws.roomCode = code;
        ws.role = 'guest';
        ws.name = name;
        rooms[code].guests.push({ name, ws });

        send(ws, { type: 'joined', code, name });

        // أخبر المقدم
        const hostWs = rooms[code].host;
        send(hostWs, {
          type: 'guest_joined',
          guests: rooms[code].guests.map(g => g.name)
        });
        break;
      }

      // مشارك يضغط الزر
      case 'press_button': {
        const code = ws.roomCode;
        if (!code || !rooms[code]) return;

        const now = new Date();
        const time = now.toTimeString().slice(0,8);
        const notif = { name: ws.name, time };
        rooms[code].notifications.unshift(notif);

        // أرسل للمقدم فوراً
        const hostWs = rooms[code].host;
        send(hostWs, { type: 'notification', notif });
        break;
      }
    }
  });

  ws.on('close', () => {
    const code = ws.roomCode;
    if (!code || !rooms[code]) return;

    if (ws.role === 'host') {
      // أخبر الكل إن الجلسة انتهت
      broadcast(code, { type: 'session_ended' });
      delete rooms[code];
    } else if (ws.role === 'guest') {
      rooms[code].guests = rooms[code].guests.filter(g => g.ws !== ws);
      const hostWs = rooms[code].host;
      send(hostWs, {
        type: 'guest_left',
        name: ws.name,
        guests: rooms[code].guests.map(g => g.name)
      });
    }
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ السيرفر شغال على http://localhost:${PORT}`);
  console.log(`📱 من أجهزة أخرى في نفس الشبكة افتح: http://[IP_جهازك]:${PORT}`);
  console.log(`\nلتعرف IP جهازك:`);
  console.log('  Windows: ipconfig');
  console.log('  Mac/Linux: ifconfig\n');
});
