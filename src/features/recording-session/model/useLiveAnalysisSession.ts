import { useState } from "react";
import { LiveAnalysisUpdate, toWebSocketUrl } from "../../../api/analysisApi";
import { CaptureBase, LiveAnalysisState } from "./types";

export function useLiveAnalysisSession() {
  const [liveAnalysis, setLiveAnalysis] = useState<LiveAnalysisUpdate | null>(null);
  const [liveAnalysisState, setLiveAnalysisState] = useState<LiveAnalysisState>("idle");

  const resetLiveAnalysis = () => {
    setLiveAnalysis(null);
    setLiveAnalysisState("idle");
  };

  const attachLiveAnalysisSocket = async (
    stream: MediaStream,
    liveAnalysisPath: string,
    analysisModeRef: CaptureBase["analysisModeRef"]
  ): Promise<Pick<CaptureBase, "socket" | "samplerVideo" | "samplerCanvas" | "samplerIntervalId">> => {
    let samplerVideo: HTMLVideoElement | null = null;
    let samplerCanvas: HTMLCanvasElement | null = null;
    let samplerIntervalId: number | null = null;
    let socket: WebSocket | null = null;

    try {
      socket = new WebSocket(toWebSocketUrl(liveAnalysisPath));
      setLiveAnalysisState("connecting");

      socket.onopen = () => {
        setLiveAnalysisState("live");
      };

      socket.onmessage = (event) => {
        try {
          const nextUpdate = JSON.parse(event.data) as LiveAnalysisUpdate;
          setLiveAnalysis(nextUpdate);
          setLiveAnalysisState("live");
        } catch {
          setLiveAnalysisState("offline");
        }
      };

      socket.onerror = () => {
        setLiveAnalysisState("offline");
      };

      socket.onclose = () => {
        setLiveAnalysisState((current) => (current === "idle" ? "idle" : "offline"));
      };

      samplerVideo = document.createElement("video");
      samplerVideo.srcObject = stream;
      samplerVideo.muted = true;
      samplerVideo.autoplay = true;
      samplerVideo.playsInline = true;

      try {
        await samplerVideo.play();
      } catch {
        // The visible preview can still drive camera activation later.
      }

      samplerCanvas = document.createElement("canvas");
      const context = samplerCanvas.getContext("2d");
      const canvas = samplerCanvas;

      if (context) {
        samplerIntervalId = window.setInterval(() => {
          if (!socket || socket.readyState !== WebSocket.OPEN || !samplerVideo || !canvas) {
            return;
          }

          if (samplerVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return;
          }

          const sourceWidth = samplerVideo.videoWidth || 360;
          const sourceHeight = samplerVideo.videoHeight || 640;
          const targetWidth = 320;
          const targetHeight = Math.max(
            180,
            Math.round((sourceHeight / sourceWidth) * targetWidth)
          );

          if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
          }

          context.drawImage(samplerVideo, 0, 0, targetWidth, targetHeight);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.72);

          socket.send(
            JSON.stringify({
              frame: dataUrl.split(",")[1],
              timestampMs: Date.now(),
              analysisMode: analysisModeRef.current
            })
          );
        }, 200);
      }
    } catch {
      setLiveAnalysisState("offline");
    }

    return {
      socket,
      samplerVideo,
      samplerCanvas,
      samplerIntervalId
    };
  };

  return {
    liveAnalysis,
    liveAnalysisState,
    attachLiveAnalysisSocket,
    resetLiveAnalysis
  };
}
