let localStream;
let peerConnection;
let ws;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};
let clientId = null;
let peerId = null;
let isNegotiating = false;
let isWebRTCSupported = !!(navigator.mediaDevices && window.RTCPeerConnection);
let remoteDashManifest = null;
let shakaPlayer = null;
let videoRecorder = null;

// Initialize WebSocket
function initWebSocket() {
  ws = new WebSocket('ws://localhost:3000');
  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log(`[DEBUG] Received message: ${message.type}`);

      if (message.type === 'id') {
        clientId = message.clientId;
        statusDiv.textContent = 'Connected to server. Waiting for peer...';
        ws.send(JSON.stringify({ type: 'join' }));
      } else if (message.type === 'peer') {
        peerId = message.peerId;
        statusDiv.textContent = 'Peer detected. Ready to start call.';
      } else if (message.type === 'peerDisconnected') {
        if (message.peerId === peerId) {
          peerId = null;
          stopCall();
          statusDiv.textContent = 'Peer disconnected. Waiting for new peer...';
        }
      } else if (message.senderId === clientId) {
        return;
      } else if (isWebRTCSupported && message.offer && message.senderId === peerId) {
        if (!peerConnection) createPeerConnection();
        if (peerConnection.signalingState !== 'stable') return;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
        if (localStream) {
          const existingTracks = peerConnection.getSenders().map((sender) => sender.track);
          localStream.getTracks().forEach((track) => {
            if (!existingTracks.includes(track)) peerConnection.addTrack(track, localStream);
          });
        }
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'answer', answer, targetId: message.senderId }));
        statusDiv.textContent = 'Connected to remote peer.';
      } else if (isWebRTCSupported && message.answer && message.senderId === peerId) {
        if (peerConnection.signalingState !== 'have-local-offer') return;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
        isNegotiating = false;
        statusDiv.textContent = 'Connected to remote peer.';
      } else if (isWebRTCSupported && message.candidate && message.senderId === peerId) {
        if (!peerConnection) return;
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        } catch (error) {
          console.error('[DEBUG] Error adding ICE candidate:', error);
        }
      } else if (message.type === 'dashManifest' && message.peerId === peerId) {
        remoteDashManifest = message.manifest;
        console.log(`[DEBUG] Received DASH manifest: ${remoteDashManifest}`);
        if (!isWebRTCSupported || peerConnection?.connectionState === 'failed') {
          initDashPlayer(remoteDashManifest);
        }
      }
    } catch (error) {
      console.error('[DEBUG] Signaling error:', error);
      statusDiv.textContent = 'Signaling error. Please stop and restart the call.';
    }
  };

  ws.onclose = () => {
    console.log('[DEBUG] WebSocket closed');
    stopCall();
    statusDiv.textContent = 'Disconnected from server. Please refresh.';
  };
}

initWebSocket();

function createPeerConnection() {
  console.log('[DEBUG] Creating peer connection');
  peerConnection = new RTCPeerConnection(servers);

  if (localStream) {
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
  }

  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      statusDiv.textContent = 'Connected to remote peer.';
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && peerId) {
      ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, targetId: peerId }));
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`[DEBUG] Peer connection state: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'failed') {
      statusDiv.textContent = 'WebRTC connection failed. Falling back to DASH.';
      stopCall();
      if (remoteDashManifest) initDashPlayer(remoteDashManifest);
    }
  };

  peerConnection.onnegotiationneeded = async () => {
    if (isNegotiating || peerConnection.signalingState !== 'stable') return;
    isNegotiating = true;
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', offer, targetId: peerId }));
    } catch (error) {
      console.error('[DEBUG] Renegotiation error:', error);
      isNegotiating = false;
    }
  };
}

async function startCall() {
  if (!peerId) {
    statusDiv.textContent = 'Waiting for peer to join...';
    for (let i = 0; i < 20; i++) {
      if (peerId) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (i % 5 === 4) ws.send(JSON.stringify({ type: 'join' }));
    }
    if (!peerId) {
      statusDiv.textContent = 'No peer available. Please wait or try again.';
      startButton.disabled = false;
      return;
    }
  }

  try {
    console.log('[DEBUG] Getting user media');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    // Start recording and uploading video for DASH
    startVideoUpload();

    if (isWebRTCSupported) {
      if (!peerConnection) createPeerConnection();
      const existingTracks = peerConnection.getSenders().map((sender) => sender.track);
      localStream.getTracks().forEach((track) => {
        if (!existingTracks.includes(track)) peerConnection.addTrack(track, localStream);
      });
      if (!isNegotiating && peerConnection.signalingState === 'stable') {
        isNegotiating = true;
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'offer', offer, targetId: peerId }));
      }
    } else {
      statusDiv.textContent = 'WebRTC not supported. Using DASH streaming.';
      if (remoteDashManifest) initDashPlayer(remoteDashManifest);
    }

    startButton.disabled = true;
    stopButton.disabled = false;
    statusDiv.textContent = 'Initiating call...';
  } catch (error) {
    console.error('[DEBUG] WebRTC error:', error);
    statusDiv.textContent = 'WebRTC failed. Falling back to DASH.';
    if (remoteDashManifest) initDashPlayer(remoteDashManifest);
  }
}

function stopCall() {
  console.log('[DEBUG] Stopping call');
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    localVideo.srcObject = null;
  }

  if (videoRecorder) {
    videoRecorder.stop();
    videoRecorder = null;
  }

  if (shakaPlayer) {
    shakaPlayer.destroy();
    shakaPlayer = null;
  }

  remoteVideo.srcObject = null;
  peerId = null;
  remoteDashManifest = null;
  isNegotiating = false;

  startButton.disabled = false;
  stopButton.disabled = true;
  statusDiv.textContent = 'Call stopped. Waiting for peer...';
}

async function startVideoUpload() {
  if (!localStream) return;
  console.log('[DEBUG] Starting video upload for DASH');
  videoRecorder = new MediaRecorder(localStream, {
    mimeType: 'video/webm;codecs=vp8,opus',
    bitsPerSecond: 1000000
  });

  let buffer = [];
  let isUploading = false;

  videoRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
      buffer.push(event.data);
      if (buffer.length >= 5 && !isUploading) { // Buffer 5 seconds
        isUploading = true;
        try {
          const blob = new Blob(buffer, { type: 'video/webm' });
          buffer = [];
          const response = await fetch(`http://localhost:3000/upload-video/${clientId}`, {
            method: 'POST',
            body: blob,
            headers: { 'Content-Type': 'video/webm' }
          });
          if (!response.ok) {
            console.error('[DEBUG] Video upload failed:', response.status, response.statusText);
          }
        } catch (error) {
          console.error('[DEBUG] Video upload error:', error);
        }
        isUploading = false;
      }
    }
  };

  videoRecorder.onstop = () => {
    console.log('[DEBUG] Video recording stopped');
  };

  videoRecorder.start(1000); // Generate chunks every 1 second
}

async function initDashPlayer(manifestUri) {
  console.log('[DEBUG] Initializing DASH player for:', manifestUri);
  if (typeof shaka === 'undefined') {
    console.error('[DEBUG] Shaka Player not loaded');
    statusDiv.textContent = 'DASH fallback failed: Shaka Player not loaded.';
    return;
  }

  if (shakaPlayer) {
    await shakaPlayer.destroy();
    shakaPlayer = null;
  }

  shakaPlayer = new shaka.Player();
  const fullUri = `http://localhost:3000/${manifestUri}`;
  for (let i = 0; i < 10; i++) {
    try {
      const response = await fetch(fullUri, { method: 'HEAD' });
      console.log(`[DEBUG] Manifest check: ${response.status} ${response.statusText}`);
      if (response.ok) {
        await shakaPlayer.attach(remoteVideo);
        shakaPlayer.configure({
          streaming: { bufferingGoal: 10, rebufferingGoal: 2, bufferBehind: 30 },
          manifest: { dash: { ignoreMinBufferTime: true } },
          preferredVideoCodecs: ['avc1.42001E'],
          preferredAudioCodecs: ['mp4a.40.2']
        });
        console.log('[DEBUG] Attempting to load DASH manifest:', fullUri);
        await shakaPlayer.load(fullUri);
        statusDiv.textContent = 'Playing DASH stream.';
        return;
      } else {
        console.log(`[DEBUG] Manifest not ready: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('[DEBUG] Manifest check error:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.error('[DEBUG] Failed to load DASH manifest after retries:', fullUri);
  statusDiv.textContent = 'DASH fallback failed: Manifest not available.';
}