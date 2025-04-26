const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid'); // Add uuid for client IDs

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
  ws.send(JSON.stringify({ type: 'id', clientId }));
  console.log(`Client ${clientId} connected`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // Ensure the message has a target client ID
      if (data.targetId && clients.has(data.targetId)) {
        const targetWs = clients.get(data.targetId);
        if (targetWs.readyState === WebSocket.OPEN) {
          // Forward the message to the target client
          targetWs.send(JSON.stringify({ ...data, senderId: clientId }));
        }
      } else if (data.type === 'join') {
        // Notify other clients of the new client for pairing
        clients.forEach((clientWs, id) => {
          if (id !== clientId && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'peer', peerId: clientId }));
          }
        });
      }
    } catch (error) {
      console.error('Server message error:', error);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`Client ${clientId} disconnected`);
  });
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});