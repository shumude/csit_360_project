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
const isWebRTCSupported = !!(navigator.mediaDevices && window.RTCPeerConnection);

// Initialize WebSocket
function initWebSocket() {
  ws = new WebSocket('ws://localhost:3000');
  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log(`[DEBUG] Received message: ${message.type}`);

      if (message.type === 'id') {
        clientId = message.clientId;
        updateStatus('Connected to server. Waiting for peer...', 'info');
        ws.send(JSON.stringify({ type: 'join' }));
      } else if (message.type === 'peer') {
        peerId = message.peerId;
        updateStatus('Peer detected. Ready to start call.', 'info');
      } else if (message.type === 'peerDisconnected') {
        if (message.peerId === peerId) {
          peerId = null;
          stopCall();
          updateStatus('Peer disconnected. Waiting for new peer...', 'warning');
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
        updateStatus('Connected to peer.', 'success');
      } else if (isWebRTCSupported && message.answer && message.senderId === peerId) {
        if (peerConnection.signalingState !== 'have-local-offer') return;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
        isNegotiating = false;
        updateStatus('Connected to peer.', 'success');
      } else if (isWebRTCSupported && message.candidate && message.senderId === peerId) {
        if (!peerConnection) return;
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        } catch (error) {
          console.error('[DEBUG] Error adding ICE candidate:', error);
        }
      }
    } catch (error) {
      console.error('[DEBUG] Signaling error:', error);
      updateStatus('Signaling error. Please stop and restart the call.', 'error');
    }
  };

  ws.onclose = () => {
    console.log('[DEBUG] WebSocket closed');
    stopCall();
    updateStatus('Disconnected from server. Please refresh.', 'error');
  };
}

function createPeerConnection() {
  console.log('[DEBUG] Creating peer connection');
  peerConnection = new RTCPeerConnection(servers);

  if (localStream) {
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
  }

  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      updateStatus('Connected to peer.', 'success');
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
      updateStatus('WebRTC connection failed. Please try again.', 'error');
      stopCall();
    } else if (peerConnection.connectionState === 'connected') {
      updateStatus('Connected to peer.', 'success');
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
      updateStatus('Negotiation error. Please try again.', 'error');
    }
  };
}

async function startCall() {
  if (!isWebRTCSupported) {
    updateStatus('WebRTC not supported by this browser.', 'error');
    return;
  }

  if (!peerId) {
    updateStatus('Waiting for peer to join...', 'info');
    for (let i = 0; i < 20; i++) {
      if (peerId) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (i % 5 === 4) ws.send(JSON.stringify({ type: 'join' }));
    }
    if (!peerId) {
      updateStatus('No peer available. Please wait or try again.', 'warning');
      startButton.disabled = false;
      return;
    }
  }

  try {
    console.log('[DEBUG] Getting user media');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

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

    startButton.disabled = true;
    stopButton.disabled = false;
    updateStatus('Initiating call...', 'info');
  } catch (error) {
    console.error('[DEBUG] WebRTC error:', error);
    updateStatus('Failed to access camera/microphone. Please check permissions.', 'error');
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

  remoteVideo.srcObject = null;
  peerId = null;
  isNegotiating = false;

  startButton.disabled = false;
  stopButton.disabled = true;
  updateStatus('Call stopped. Waiting for peer...', 'info');
}

function updateStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

// Initialize
if (!isWebRTCSupported) {
  updateStatus('WebRTC not supported by this browser.', 'error');
} else {
  updateStatus('Checking WebRTC support...', 'info');
  initWebSocket();
}