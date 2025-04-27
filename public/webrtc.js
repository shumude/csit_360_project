const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

let peerConnection = null;
let localStream = null;
let peerId = null;
let isNegotiating = false;

// Check WebRTC support
const isWebRTCSupported = (() => {
  const hasMediaDevices = !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
  const hasRTCPeerConnection = typeof window.RTCPeerConnection === 'function' || typeof window.webkitRTCPeerConnection === 'function';
  const isSecureContext = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
  console.log(`[DEBUG] WebRTC support check: mediaDevices=${hasMediaDevices}, RTCPeerConnection=${hasRTCPeerConnection}, secureContext=${isSecureContext}`);
  return hasMediaDevices && hasRTCPeerConnection && isSecureContext;
})();

function createPeerConnection(ws, clientId, updateStatus) {
  console.log('[DEBUG] Creating peer connection');
  try {
    peerConnection = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)(servers);
  } catch (error) {
    console.error('[DEBUG] Failed to create RTCPeerConnection:', error);
    updateStatus('WebRTC initialization failed. Please try a different browser.', 'error');
    throw error;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
  }

  peerConnection.ontrack = (event) => {
    if (event.streams && event.streams[0]) {
      document.getElementById('remoteVideo').srcObject = event.streams[0];
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
      stopCall(updateStatus);
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

async function startCall(ws, clientId, updateStatus) {
  if (!isWebRTCSupported) {
    updateStatus('WebRTC not supported by this browser. Please use Chrome or Safari.', 'error');
    return;
  }

  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
    updateStatus('WebRTC requires a secure context (HTTPS or localhost). Please serve over HTTPS.', 'error');
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
      document.getElementById('startButton').disabled = false;
      return;
    }
  }

  try {
    console.log('[DEBUG] Getting user media');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;

    if (!peerConnection) createPeerConnection(ws, clientId, updateStatus);
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

    document.getElementById('startButton').disabled = true;
    document.getElementById('stopButton').disabled = false;
    updateStatus('Initiating call...', 'info');
  } catch (error) {
    console.error('[DEBUG] WebRTC error:', error);
    if (error.name === 'NotAllowedError') {
      updateStatus('Camera/microphone access denied. Please allow permissions and try again.', 'error');
    } else if (error.name === 'NotFoundError') {
      updateStatus('No camera/microphone found. Please connect a device and try again.', 'error');
    } else {
      updateStatus('Failed to access camera/microphone. Please check permissions or try a different browser.', 'error');
    }
  }
}

function stopCall(updateStatus) {
  console.log('[DEBUG] Stopping call');
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    document.getElementById('localVideo').srcObject = null;
  }

  document.getElementById('remoteVideo').srcObject = null;
  peerId = null;
  isNegotiating = false;

  document.getElementById('startButton').disabled = false;
  document.getElementById('stopButton').disabled = true;
  updateStatus('Call stopped. Waiting for peer...', 'info');
}