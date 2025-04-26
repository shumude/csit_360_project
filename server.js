const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store client IDs and their WebSocket connections
const clients = new Map();
const dashManifests = new Map();

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
            if (dashManifests.has(id)) {
              ws.send(JSON.stringify({ type: 'dashManifest', peerId: id, manifest: dashManifests.get(id) }));
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
    dashManifests.delete(clientId);
    const dashDir = path.join(__dirname, 'public', 'dash', `client-${clientId}`);
    try {
      await fs.rm(dashDir, { recursive: true, force: true });
      console.log(`Deleted DASH directory for ${clientId}`);
    } catch (err) {
      console.error(`Error deleting DASH directory for ${clientId}:`, err);
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
  const dashDir = path.join(__dirname, 'public', 'dash', `client-${clientId}`);
  await fs.mkdir(dashDir, { recursive: true });
  const manifestPath = path.join(dashDir, 'output.mpd');

  const gstreamer = spawn('gst-launch-1.0', [
    'fdsrc', // Read from stdin
    '!', 'queue', // Buffer input
    '!', 'webmdec', // Decode WebM
    '!', 'x264enc', 'tune=zerolatency', // H.264 encoding
    '!', 'mpegtsmux', // Mux to MPEG-TS
    '!', 'dashsink', `location=${dashDir}/output_%d.m4s`, `manifest-location=${manifestPath}`
  ]);

  let isManifestCreated = false;
  let gstreamerError = '';
  const checkManifest = async () => {
    try {
      await fs.access(manifestPath);
      isManifestCreated = true;
      console.log(`DASH manifest created for ${clientId}: ${manifestPath}`);
      const manifestRelativePath = `dash/client-${clientId}/output.mpd`;
      dashManifests.set(clientId, manifestRelativePath);
      clients.forEach((clientWs, id) => {
        if (id !== clientId && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'dashManifest', peerId: clientId, manifest: manifestRelativePath }));
        }
      });
    } catch (err) {
      // Manifest not yet created
    }
  };

  const manifestCheckInterval = setInterval(checkManifest, 1000);

  req.pipe(gstreamer.stdin);

  gstreamer.stderr.on('data', (data) => {
    gstreamerError += data.toString();
    console.log(`GStreamer output for ${clientId}: ${data.toString()}`);
  });

  gstreamer.on('close', (code) => {
    clearInterval(manifestCheckInterval);
    console.log(`GStreamer process for ${clientId} closed with code ${code}`);
    if (code !== 0) {
      console.error(`GStreamer error details for ${clientId}:`, gstreamerError);
    }
    res.status(code === 0 ? 200 : 500).send(code === 0 ? 'Success' : `GStreamer error: ${gstreamerError}`);
    if (!isManifestCreated) {
      console.error(`GStreamer failed to create manifest for ${clientId}`);
    }
  });

  req.on('error', (err) => {
    console.error(`Upload error for ${clientId}:`, err);
    res.status(500).send('Upload error');
  });
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});