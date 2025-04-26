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
let remoteHlsPlaylist = null;
let hls = null;

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
      } else if (message.type === 'hlsPlaylist' && message.peerId === peerId) {
        remoteHlsPlaylist = message.playlist;
        console.log(`[DEBUG] Received HLS playlist: ${remoteHlsPlaylist}`);
        if (!isWebRTCSupported || peerConnection?.connectionState === 'failed') {
          initHlsPlayer(remoteHlsPlaylist);
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
      statusDiv.textContent = 'WebRTC connection failed. Falling back to HLS.';
      stopCall();
      if (remoteHlsPlaylist) initHlsPlayer(remoteHlsPlaylist);
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
      if (peerId) break;
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

    // Start recording and uploading video for HLS
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
      statusDiv.textContent = 'WebRTC not supported. Using HLS streaming.';
      if (remoteHlsPlaylist) initHlsPlayer(remoteHlsPlaylist);
    }

    startButton.disabled = true;
    stopButton.disabled = false;
    statusDiv.textContent = 'Initiating call...';
  } catch (error) {
    console.error('[DEBUG] WebRTC error:', error);
    statusDiv.textContent = 'WebRTC failed. Falling back to HLS.';
    if (remoteHlsPlaylist) initHlsPlayer(remoteHlsPlaylist);
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

  if (hls) {
    hls.destroy();
    hls = null;
  }

  remoteVideo.srcObject = null;
  peerId = null;
  remoteHlsPlaylist = null;
  isNegotiating = false;

  startButton.disabled = false;
  stopButton.disabled = true;
  statusDiv.textContent = 'Call stopped. Waiting for peer...';
}

async function startVideoUpload() {
  if (!localStream) return;
  console.log('[DEBUG] Starting video upload for HLS');
  videoRecorder = new MediaRecorder(localStream, {
    mimeType: 'video/webm;codecs=vp8,opus',
    bitsPerSecond: 1000000
  });

  videoRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
      try {
        const response = await fetch(`http://localhost:3000/upload-video/${clientId}`, {
          method: 'POST',
          body: event.data,
          headers: { 'Content-Type': 'video/webm' }
        });
        if (!response.ok) {
          console.error('[DEBUG] Video upload failed:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('[DEBUG] Video upload error:', error);
      }
    }
  };

  videoRecorder.onstop = () => {
    console.log('[DEBUG] Video recording stopped');
  };

  videoRecorder.start(5000); // Generate chunks every 5 seconds
}

async function initHlsPlayer(playlistUri) {
  console.log('[DEBUG] Initializing HLS player for:', playlistUri);
  const fullUri = `http://localhost:3000/${playlistUri}`;
  if (Hls.isSupported()) {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    hls = new Hls();
    hls.loadSource(fullUri);
    hls.attachMedia(remoteVideo);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      remoteVideo.play();
      statusDiv.textContent = 'Playing HLS stream.';
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      console.error('[DEBUG] HLS error:', data);
      statusDiv.textContent = `HLS playback error: ${data.type}`;
    });
  } else if (remoteVideo.canPlayType('application/vnd.apple.mpegurl')) {
    remoteVideo.src = fullUri;
    remoteVideo.play().then(() => {
      statusDiv.textContent = 'Playing HLS stream.';
    }).catch((error) => {
      console.error('[DEBUG] HLS playback error:', error);
      statusDiv.textContent = 'HLS playback failed.';
    });
  } else {
    console.error('[DEBUG] HLS not supported');
    statusDiv.textContent = 'HLS streaming not supported.';
  }
}