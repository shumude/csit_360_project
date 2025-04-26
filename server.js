const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store client IDs and their WebSocket connections
const clients = new Map();

wss.on('connection', (ws) => {
  // Assign a unique ID to the client
  const clientId = uuidv4();
  clients.set(clientId, ws);
  console.log(`[DEBUG] Client ${clientId} connected`);
  ws.send(JSON.stringify({ type: 'id', clientId }));
  console.log(`[DEBUG] Sent clientId ${clientId} to client`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`[DEBUG] Received message from ${clientId}:`, data);

      if (data.targetId && clients.has(data.targetId)) {
        // Forward signaling messages to the target client
        const targetWs = clients.get(data.targetId);
        if (targetWs.readyState === WebSocket.OPEN) {
          console.log(`[DEBUG] Forwarding message from ${clientId} to ${data.targetId}:`, data);
          targetWs.send(JSON.stringify({ ...data, senderId: clientId }));
        } else {
          console.log(`[DEBUG] Target ${data.targetId} not open, ignoring message`);
        }
      } else if (data.type === 'join') {
        // Notify all existing clients of the new client
        console.log(`[DEBUG] Client ${clientId} joined, notifying peers`);
        clients.forEach((clientWs, id) => {
          if (id !== clientId && clientWs.readyState === WebSocket.OPEN) {
            console.log(`[DEBUG] Notifying ${id} of new peer ${clientId}`);
            clientWs.send(JSON.stringify({ type: 'peer', peerId: clientId }));
            // Notify the new client of existing clients
            console.log(`[DEBUG] Notifying ${clientId} of existing peer ${id}`);
            ws.send(JSON.stringify({ type: 'peer', peerId: id }));
          }
        });
      } else {
        console.log(`[DEBUG] Unhandled message from ${clientId}:`, data);
      }
    } catch (error) {
      console.error(`[DEBUG] Server message error for ${clientId}:`, error);
    }
  });

  ws.on('close', () => {
    console.log(`[DEBUG] Client ${clientId} disconnected`);
    clients.delete(clientId);
    // Notify other clients of disconnection
    clients.forEach((clientWs, id) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        console.log(`[DEBUG] Notifying ${id} of peer ${clientId} disconnection`);
        clientWs.send(JSON.stringify({ type: 'peerDisconnected', peerId: clientId }));
      }
    });
  });
});

server.listen(3000, () => {
  console.log('[DEBUG] Server running on http://localhost:3000');
});