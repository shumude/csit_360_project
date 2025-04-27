let ws;
let clientId = null;

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
          stopCall(updateStatus);
          updateStatus('Peer disconnected. Waiting for new peer...', 'warning');
        }
      } else if (message.senderId === clientId) {
        return;
      } else if (isWebRTCSupported && message.offer && message.senderId === peerId) {
        if (!peerConnection) createPeerConnection(ws, clientId, updateStatus);
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
    stopCall(updateStatus);
    updateStatus('Disconnected from server. Please refresh.', 'error');
  };
}

// Initialize
if (!isWebRTCSupported) {
  updateStatus('WebRTC not supported by this browser. Please use Chrome or Safari.', 'error');
} else if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
  updateStatus('WebRTC requires a secure context (HTTPS or localhost). Please serve over HTTPS.', 'error');
} else {
  updateStatus('Checking WebRTC support...', 'info');
  initWebSocket();
}