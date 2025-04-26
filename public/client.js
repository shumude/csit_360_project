let localStream;
let peerConnection;
const ws = new WebSocket('ws://localhost:3000');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const servers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let clientId = null;
let peerId = null;

// Check WebRTC support
if (!navigator.mediaDevices || !window.RTCPeerConnection) {
  statusDiv.textContent = 'WebRTC not supported. Falling back to DASH.';
  startButton.disabled = true;
  initDashPlayer();
} else {
  statusDiv.textContent = 'WebRTC supported. Connecting to server...';
}

// WebSocket signaling
ws.onmessage = async (event) => {
  try {
    const message = JSON.parse(event.data);
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
    } else if (message.offer && message.senderId === peerId) {
      if (!peerConnection) {
        createPeerConnection();
      }
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', answer, targetId: message.senderId }));
      statusDiv.textContent = 'Connected to remote peer.';
    } else if (message.answer && message.senderId === peerId) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
      statusDiv.textContent = 'Connected to remote peer.';
    } else if (message.candidate && message.senderId === peerId) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
  } catch (error) {
    console.error('Signaling error:', error);
    statusDiv.textContent = 'Signaling error. Please stop and restart the call.';
  }
};

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(servers);

  if (localStream) {
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
  }

  peerConnection.ontrack = (event) => {
    if (remoteVideo.srcObject !== event.streams[0]) {
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
    if (peerConnection.connectionState === 'failed') {
      statusDiv.textContent = 'WebRTC connection failed. Falling back to DASH.';
      stopCall();
      initDashPlayer();
    }
  };
}

async function startCall() {
  // Wait for peerId to be set
  if (!peerId) {
    statusDiv.textContent = 'Waiting for peer to join...';
    for (let i = 0; i < 10; i++) {
      if (peerId) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!peerId) {
      statusDiv.textContent = 'No peer available. Please wait for another client to join.';
      return;
    }
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    createPeerConnection();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', offer, targetId: peerId }));

    startButton.disabled = true;
    stopButton.disabled = false;
    statusDiv.textContent = 'Initiating call...';
  } catch (error) {
    console.error('WebRTC error:', error);
    statusDiv.textContent = 'WebRTC failed. Falling back to DASH.';
    initDashPlayer();
  }
}

function stopCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    localVideo.srcObject = null;
  }

  remoteVideo.srcObject = null;
  peerId = null;

  startButton.disabled = false;
  stopButton.disabled = true;
  statusDiv.textContent = 'Call stopped. Waiting for peer...';
}

// DASH Fallback
function initDashPlayer() {
  const videoElement = remoteVideo;
  const player = new shaka.Player(videoElement);

  player.load('dash/output.mpd').catch((error) => {
    console.error('DASH error:', error);
    statusDiv.textContent = 'Failed to load DASH stream.';
  });
}