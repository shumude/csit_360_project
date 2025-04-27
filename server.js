const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const fsSync = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store client IDs and their WebSocket connections
const clients = new Map();
const hlsPlaylists = new Map();

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
            if (hlsPlaylists.has(id)) {
              ws.send(JSON.stringify({ type: 'hlsPlaylist', peerId: id, playlist: hlsPlaylists.get(id).url }));
            }
          }
        });
      }
    } catch (error) {
      console.error(`Server message error for ${clientId}:`, error);
    }
  });

  ws.on('close', async () => {
    console.log(`Client ${clientId} disconnected`);
    clients.delete(clientId);
    hlsPlaylists.delete(clientId);
    const hlsDir = path.join(__dirname, 'public', 'hls', `client-${clientId}`);
    try {
      await fs.rm(hlsDir, { recursive: true, force: true });
      console.log(`Deleted HLS directory for ${clientId}`);
    } catch (err) {
      console.error(`Error deleting HLS directory for ${clientId}:`, err);
    }
    clients.forEach((clientWs, id) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'peerDisconnected', peerId: clientId }));
      }
    });
  });
});

// Endpoint to receive video stream
app.post('/upload-video/:clientId', async (req, res) => {
  const clientId = req.params.clientId;
  console.log(`Receiving video stream from ${clientId}`);
  const hlsDir = path.join(__dirname, 'public', 'hls', `client-${clientId}`);
  await fs.mkdir(hlsDir, { recursive: true });
  const chunkIndex = hlsPlaylists.has(clientId) ? hlsPlaylists.get(clientId).chunkCount : 0;
  const chunkFile = path.join(hlsDir, `chunk-${chunkIndex}.mp4`);
  const playlistFile = path.join(hlsDir, 'playlist.m3u8');

  // Validate Content-Type
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('video/mp4')) {
    console.error(`Invalid Content-Type for ${clientId}: ${contentType}`);
    return res.status(400).send('Invalid video format. Expected video/mp4.');
  }

  const writeStream = fsSync.createWriteStream(chunkFile);
  req.pipe(writeStream);

  writeStream.on('finish', async () => {
    try {
      // Verify chunk accessibility
      await fs.access(chunkFile);
      const stats = await fs.stat(chunkFile);
      if (stats.size < 1000) {
        throw new Error('Chunk file is too small or empty');
      }

      // Update playlist
      let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n';
      const chunkCount = chunkIndex + 1;
      for (let i = Math.max(0, chunkCount - 5); i < chunkCount; i++) {
        playlist += `#EXTINF:5.0,\nchunk-${i}.mp4\n`;
      }
      await fs.writeFile(playlistFile, playlist);

      const playlistUrl = `hls/client-${clientId}/playlist.m3u8`;
      hlsPlaylists.set(clientId, { url: playlistUrl, chunkCount });
      console.log(`HLS playlist updated for ${clientId}: ${playlistUrl}`);
      clients.forEach((clientWs, id) => {
        if (id !== clientId && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'hlsPlaylist', peerId: clientId, playlist: playlistUrl }));
        }
      });

      res.status(200).send('Success');
    } catch (error) {
      console.error(`HLS error for ${clientId}:`, error);
      res.status(500).send(`HLS error: ${error.message}`);
    }
  });

  writeStream.on('error', (err) => {
    console.error(`Write error for ${clientId}:`, err);
    res.status(500).send('Write error');
  });

  req.on('error', (err) => {
    console.error(`Upload error for ${clientId}:`, err);
    res.status(500).send('Upload error');
  });
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});