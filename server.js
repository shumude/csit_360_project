const express = require('express');
const https = require('https'); // Changed from http to https
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs'); // Required to read certificate files

const app = express();

// Load SSL/TLS certificate and key
const privateKey = fs.readFileSync(path.join(__dirname, 'certs/key.pem'), 'utf8');
const certificate = fs.readFileSync(path.join(__dirname, 'certs/cert.pem'), 'utf8');
const credentials = { key: privateKey, cert: certificate };

// Create HTTPS server
const server = https.createServer(credentials, app); // Use HTTPS with credentials
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store client IDs and their WebSocket connections
const clients = new Map();

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  console.log(`Client ${clientId} connected`);
  ws.send(JSON.stringify({ type: 'id', clientId }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Received message from ${clientId}: ${data.type}`);

      if (data.targetId && clients.has(data.targetId)) {
        const targetWs = clients.get(data.targetId);
        if (targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ ...data, senderId: clientId }));
        }
      } else if (data.type === 'join') {
        console.log(`Client ${clientId} joined`);
        clients.forEach((clientWs, id) => {
          if (id !== clientId && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'peer', peerId: clientId }));
            ws.send(JSON.stringify({ type: 'peer', peerId: id }));
          }
        });
      }
    } catch (error) {
      console.error(`Server message error for ${clientId}:`, error);
    }
  });

  ws.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    clients.delete(clientId);
    clients.forEach((clientWs, id) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'peerDisconnected', peerId: clientId }));
      }
    });
  });
});

server.listen(3000, () => {
  console.log('Server running on https://localhost:3000');
});