import { ActiveCapture, CaptureBase } from "./types";

export function teardownCapture(capture: CaptureBase | ActiveCapture | null) {
  if (!capture) {
    return;
  }

  if (capture.samplerIntervalId !== null) {
    window.clearInterval(capture.samplerIntervalId);
  }

  if (capture.socket) {
    capture.socket.onopen = null;
    capture.socket.onmessage = null;
    capture.socket.onerror = null;
    capture.socket.onclose = null;

    if (
      capture.socket.readyState === WebSocket.CONNECTING ||
      capture.socket.readyState === WebSocket.OPEN
    ) {
      capture.socket.close();
    }
  }

  if (capture.samplerVideo) {
    capture.samplerVideo.pause();
    capture.samplerVideo.srcObject = null;
  }

  capture.stream.getTracks().forEach((track) => track.stop());
}
