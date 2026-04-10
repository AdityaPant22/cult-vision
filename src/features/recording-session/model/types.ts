import { SupportedExerciseId } from "../../../types";

export type StopMode = "save" | "cancel";

export type StopMeta = {
  mode: StopMode;
  stoppedAt: string | null;
  liveRepCount?: number;
};

export type LiveAnalysisMode = "calibration" | "recording";

export type CaptureBase = {
  recordingId: string;
  plannedStartedAt: string;
  exerciseId: SupportedExerciseId;
  stream: MediaStream;
  socket: WebSocket | null;
  samplerVideo: HTMLVideoElement | null;
  samplerCanvas: HTMLCanvasElement | null;
  samplerIntervalId: number | null;
  analysisModeRef: {
    current: LiveAnalysisMode;
  };
};

export type ActiveCapture = CaptureBase & {
  recorder: MediaRecorder;
  actualStartedAt: string;
};

export type CountdownCapture = CaptureBase;

export type LiveAnalysisState = "idle" | "connecting" | "live" | "offline";
