let localStream;
let peerConnection;
const ws = new WebSocket('ws://localhost:3000');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const servers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};
let clientId = null;
let peerId = null;
let isNegotiating = false;

// Check WebRTC support
if (!navigator.mediaDevices || !window.RTCPeerConnection) {
  console.log('[DEBUG] WebRTC not supported, initiating DASH fallback');
  statusDiv.textContent = 'WebRTC not supported. Falling back to DASH.';
  startButton.disabled = true;
  initDashPlayer();
} else {
  console.log('[DEBUG] WebRTC supported');
  statusDiv.textContent = 'WebRTC supported. Connecting to server...';
}

// WebSocket signaling
ws.onmessage = async (event) => {
  try {
    const message = JSON.parse(event.data);
    console.log('[DEBUG] Received WebSocket message:', message);

    if (message.type === 'id') {
      clientId = message.clientId;
      console.log(`[DEBUG] Assigned clientId: ${clientId}`);
      statusDiv.textContent = 'Connected to server. Waiting for peer...';
      ws.send(JSON.stringify({ type: 'join' }));
      console.log('[DEBUG] Sent join message');
    } else if (message.type === 'peer') {
      peerId = message.peerId;
      console.log(`[DEBUG] Detected peer: ${peerId}`);
      statusDiv.textContent = 'Peer detected. Ready to start call.';
    } else if (message.type === 'peerDisconnected') {
      if (message.peerId === peerId) {
        console.log(`[DEBUG] Peer ${peerId} disconnected`);
        peerId = null;
        stopCall();
        statusDiv.textContent = 'Peer disconnected. Waiting for new peer...';
      }
    } else if (message.senderId === clientId) {
      console.log('[DEBUG] Ignoring own message from senderId:', message.senderId);
      return;
    } else if (message.offer && message.senderId === peerId) {
      console.log(`[DEBUG] Received offer from peer ${message.senderId}`);
      if (!peerConnection) {
        createPeerConnection();
        console.log('[DEBUG] Created new peer connection for offer');
      }
      if (peerConnection.signalingState !== 'stable') {
        console.log('[DEBUG] Ignoring offer, signaling state is:', peerConnection.signalingState);
        return;
      }
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.offer));
      console.log('[DEBUG] Set remote description for offer');
      // Add local stream tracks if not already added
      if (localStream) {
        const existingTracks = peerConnection.getSenders().map((sender) => sender.track);
        localStream.getTracks().forEach((track) => {
          if (!existingTracks.includes(track)) {
            peerConnection.addTrack(track, localStream);
            console.log(`[DEBUG] Added track for offer response: ${track.kind}`);
          }
        });
      }
      const answer = await peerConnection.createAnswer();
      console.log('[DEBUG] Created answer');
      await peerConnection.setLocalDescription(answer);
      console.log('[DEBUG] Set local description for answer');
      ws.send(JSON.stringify({ type: 'answer', answer, targetId: message.senderId }));
      console.log(`[DEBUG] Sent answer to ${message.senderId}`);
      statusDiv.textContent = 'Connected to remote peer.';
    } else if (message.answer && message.senderId === peerId) {
      console.log(`[DEBUG] Received answer from peer ${message.senderId}`);
      if (peerConnection.signalingState !== 'have-local-offer') {
        console.log('[DEBUG] Ignoring answer, signaling state is:', peerConnection.signalingState);
        return;
      }
      await peerConnection.setRemoteDescription(new RTCSessionDescription(message.answer));
      console.log('[DEBUG] Set remote description for answer');
      isNegotiating = false;
      statusDiv.textContent = 'Connected to remote peer.';
    } else if (message.candidate && message.senderId === peerId) {
      console.log(`[DEBUG] Received ICE candidate from peer ${message.senderId}`);
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(message.candidate));
        console.log('[DEBUG] Added ICE candidate successfully');
      } catch (error) {
        console.error('[DEBUG] Error adding ICE candidate:', error);
      }
    } else {
      console.log('[DEBUG] Ignored irrelevant message:', message);
    }
  } catch (error) {
    console.error('[DEBUG] Signaling error:', error);
    statusDiv.textContent = 'Signaling error. Please stop and restart the call.';
  }
};

function createPeerConnection() {
  console.log('[DEBUG] Creating peer connection');
  peerConnection = new RTCPeerConnection(servers);

  // Add local stream tracks if available
  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
      console.log(`[DEBUG] Added track: ${track.kind}`);
    });
  }

  // Handle incoming streams
  peerConnection.ontrack = (event) => {
    console.log('[DEBUG] ontrack event fired:', event);
    console.log('[DEBUG] Received stream:', event.streams[0]);
    if (event.streams && event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      console.log('[DEBUG] Assigned stream to remoteVideo');
      statusDiv.textContent = 'Connected to remote peer.';
    } else {
      console.log('[DEBUG] No streams in ontrack event');
    }
  };

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && peerId) {
      console.log('[DEBUG] Sending ICE candidate to peer:', peerId, event.candidate);
      ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, targetId: peerId }));
    } else {
      console.log('[DEBUG] No ICE candidate or peerId, skipping:', event.candidate, peerId);
    }
  };

  // Log ICE connection state changes
  peerConnection.oniceconnectionstatechange = () => {
    console.log(`[DEBUG] ICE connection state: ${peerConnection.iceConnectionState}`);
    if (peerConnection.iceConnectionState === 'failed') {
      console.log('[DEBUG] ICE connection failed, triggering DASH fallback');
      statusDiv.textContent = 'WebRTC connection failed. Falling back to DASH.';
      stopCall();
      initDashPlayer();
    }
  };

  // Log connection state changes
  peerConnection.onconnectionstatechange = () => {
    console.log(`[DEBUG] Peer connection state: ${peerConnection.connectionState}`);
    if (peerConnection.connectionState === 'failed') {
      console.log('[DEBUG] Peer connection failed, triggering DASH fallback');
      statusDiv.textContent = 'WebRTC connection failed. Falling back to DASH.';
      stopCall();
      initDashPlayer();
    }
  };

  // Handle renegotiation
  peerConnection.onnegotiationneeded = async () => {
    if (isNegotiating || peerConnection.signalingState !== 'stable') {
      console.log('[DEBUG] Skipping negotiation, already negotiating or not stable:', peerConnection.signalingState);
      return;
    }
    isNegotiating = true;
    console.log('[DEBUG] Negotiation needed');
    try {
      const offer = await peerConnection.createOffer();
      console.log('[DEBUG] Created renegotiation offer');
      await peerConnection.setLocalDescription(offer);
      console.log('[DEBUG] Set local description for renegotiation offer');
      ws.send(JSON.stringify({ type: 'offer', offer, targetId: peerId }));
      console.log(`[DEBUG] Sent renegotiation offer to peer ${peerId}`);
    } catch (error) {
      console.error('[DEBUG] Renegotiation error:', error);
      isNegotiating = false;
    }
  };
}

async function startCall() {
  console.log('[DEBUG] Attempting to start call, peerId:', peerId);
  // Wait for peerId to be set
  if (!peerId) {
    statusDiv.textContent = 'Waiting for peer to join...';
    console.log('[DEBUG] No peerId, waiting for peer');
    // Try up to 20 times (10 seconds) for peer detection
    for (let i = 0; i < 20; i++) {
      if (peerId) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(`[DEBUG] Waiting for peer, attempt ${i + 1}`);
      // Resend join message to trigger peer detection
      if (i % 5 === 4) {
        ws.send(JSON.stringify({ type: 'join' }));
        console.log('[DEBUG] Resent join message to trigger peer detection');
      }
    }
    if (!peerId) {
      console.log('[DEBUG] No peer available after waiting');
      statusDiv.textContent = 'No peer available. Please wait or try again.';
      startButton.disabled = false; // Allow retry
      return;
    }
  }

  try {
    console.log('[DEBUG] Getting user media');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    console.log('[DEBUG] Local stream acquired');

    // Create peer connection if not exists
    if (!peerConnection) {
      createPeerConnection();
      console.log('[DEBUG] Peer connection created');
    } else {
      // Add tracks to existing peer connection only if not already added
      const existingTracks = peerConnection.getSenders().map((sender) => sender.track);
      localStream.getTracks().forEach((track) => {
        if (!existingTracks.includes(track)) {
          peerConnection.addTrack(track, localStream);
          console.log(`[DEBUG] Added track to existing connection: ${track.kind}`);
        } else {
          console.log(`[DEBUG] Track already added, skipping: ${track.kind}`);
        }
      });
    }

    // Trigger offer only if not already negotiating
    if (!isNegotiating && peerConnection.signalingState === 'stable') {
      isNegotiating = true;
      const offer = await peerConnection.createOffer();
      console.log('[DEBUG] Created offer');
      await peerConnection.setLocalDescription(offer);
      console.log('[DEBUG] Set local description for offer');
      ws.send(JSON.stringify({ type: 'offer', offer, targetId: peerId }));
      console.log(`[DEBUG] Sent offer to peer ${peerId}`);
    } else {
      console.log('[DEBUG] Skipping offer creation, negotiation in progress or not stable:', peerConnection.signalingState);
    }

    startButton.disabled = true;
    stopButton.disabled = false;
    statusDiv.textContent = 'Initiating call...';
  } catch (error) {
    console.error('[DEBUG] WebRTC error:', error);
    statusDiv.textContent = 'WebRTC failed. Falling back to DASH.';
    initDashPlayer();
  }
}

function stopCall() {
  console.log('[DEBUG] Stopping call');
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
    console.log('[DEBUG] Closed peer connection');
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      track.stop();
      console.log(`[DEBUG] Stopped track: ${track.kind}`);
    });
    localStream = null;
    localVideo.srcObject = null;
    console.log('[DEBUG] Cleared local stream');
  }

  remoteVideo.srcObject = null;
  peerId = null;
  isNegotiating = false;
  console.log('[DEBUG] Reset peerId and negotiation state');

  startButton.disabled = false;
  stopButton.disabled = true;
  statusDiv.textContent = 'Call stopped. Waiting for peer...';
}

// DASH Fallback
function initDashPlayer() {
  console.log('[DEBUG] Initializing DASH player');
  const videoElement = remoteVideo;
  const player = new shaka.Player(videoElement);

  player.load('dash/output.mpd').catch((error) => {
    console.error('[DEBUG] DASH error:', error);
    statusDiv.textContent = 'Failed to load DASH stream.';
  });
}