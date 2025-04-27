const express = require('express');
const http = require('http');
const path = require('path');
const { setupWebSocket } = require('./websocket');

const app = express();
const server = http.createServer(app);

// Set up WebSocket
setupWebSocket(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});