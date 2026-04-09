import { Dispatch, useEffect, useRef, useState } from "react";
import {
  createRecordingSession,
  deleteBackendRecording,
  markRecordingUploadComplete,
  uploadRecordingBlob
} from "../../../api/analysisApi";
import { DeviceSession, Recording, SupportedExerciseId } from "../../../types";
import { calculateDurationSec, getSupportedRecordingMimeType } from "../../../shared/lib/media";
import {
  ActiveCapture,
  CaptureBase,
  CountdownCapture,
  StopMeta
} from "./types";
import { teardownCapture } from "./captureLifecycle";
import { useLiveAnalysisSession } from "./useLiveAnalysisSession";
import { useRecordingAssets } from "./useRecordingAssets";
import { useLiveRepSync } from "./useLiveRepSync";

type RecordingDispatch = Dispatch<any>;

type RecordingSessionParams = {
  activeUser: {
    userId: string;
    userName: string;
    phoneNumber: string;
    sessionUserId: string;
  } | null;
  selectedExerciseId: SupportedExerciseId | null;
  currentRecording: Recording | null;
  deviceSession: DeviceSession;
  view: string;
  dispatch: RecordingDispatch;
  onError: (message: string | null) => void;
  verifyBackendConnection: (showError?: boolean) => Promise<boolean>;
  refreshRecordingsFromServer: (silent?: boolean) => Promise<void>;
};

export function useRecordingSession(params: RecordingSessionParams) {
  const [isPreparingCamera, setIsPreparingCamera] = useState(false);
  const [activeCapture, setActiveCapture] = useState<ActiveCapture | null>(null);
  const [countdownCapture, setCountdownCapture] = useState<CountdownCapture | null>(null);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);

  const activeCaptureRef = useRef<ActiveCapture | null>(null);
  const countdownCaptureRef = useRef<CountdownCapture | null>(null);
  const countdownTimeoutRef = useRef<number | null>(null);
  const countdownTokenRef = useRef(0);
  const stopMetaRef = useRef<StopMeta>({
    mode: "save",
    stoppedAt: null
  });
  const {
    recordingAssets,
    storeRecordingBlob,
    clearRecordingAssets,
    deleteRecordingAsset
  } = useRecordingAssets();
  const {
    liveAnalysis,
    liveAnalysisState,
    attachLiveAnalysisSocket,
    resetLiveAnalysis
  } = useLiveAnalysisSession();

  useEffect(() => {
    countdownCaptureRef.current = countdownCapture;
  }, [countdownCapture]);

  useLiveRepSync({
    view: params.view,
    currentRecording: params.currentRecording,
    liveAnalysis,
    dispatch: params.dispatch
  });

  useEffect(() => {
    return () => {
      clearCountdownPreview();

      if (activeCaptureRef.current) {
        teardownCapture(activeCaptureRef.current);
      }
    };
  }, []);

  const stopActiveStream = () => {
    if (activeCaptureRef.current) {
      teardownCapture(activeCaptureRef.current);
      activeCaptureRef.current = null;
      setActiveCapture(null);
    }

    resetLiveAnalysis();
  };

  const clearCountdownTimer = () => {
    if (countdownTimeoutRef.current !== null) {
      window.clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
  };

  const clearCountdownPreview = (stopStream = true) => {
    clearCountdownTimer();
    countdownTokenRef.current += 1;

    if (stopStream && countdownCaptureRef.current) {
      teardownCapture(countdownCaptureRef.current);
    }

    countdownCaptureRef.current = null;
    setCountdownCapture(null);
    setCountdownSec(null);
  };

  const startActualRecording = async (preparedCapture: CountdownCapture) => {
    const {
      recordingId,
      plannedStartedAt,
      exerciseId,
      stream,
      socket,
      samplerVideo,
      samplerCanvas,
      samplerIntervalId,
      analysisModeRef
    } = preparedCapture;

    if (!params.activeUser) {
      teardownCapture(preparedCapture);
      clearCountdownPreview(false);
      void deleteBackendRecording(recordingId).catch(() => {});
      return;
    }

    try {
      const TARGET_W = 720;
      const TARGET_H = 1280;

      const videoTrack = stream.getVideoTracks()[0];
      const trackSettings = videoTrack?.getSettings() ?? {};
      const srcW = trackSettings.width || 1280;
      const srcH = trackSettings.height || 720;

      const targetAspect = TARGET_W / TARGET_H;
      let sx: number, sy: number, sw: number, sh: number;
      if (srcW / srcH > targetAspect) {
        sh = srcH;
        sw = srcH * targetAspect;
        sx = (srcW - sw) / 2;
        sy = 0;
      } else {
        sw = srcW;
        sh = srcW / targetAspect;
        sx = 0;
        sy = (srcH - sh) / 2;
      }

      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = TARGET_W;
      cropCanvas.height = TARGET_H;
      const cropCtx = cropCanvas.getContext("2d")!;

      const cropVideo = document.createElement("video");
      cropVideo.srcObject = stream;
      cropVideo.muted = true;
      cropVideo.playsInline = true;
      void cropVideo.play();

      let cropRafId = 0;
      const drawCropFrame = () => {
        cropCtx.drawImage(cropVideo, sx, sy, sw, sh, 0, 0, TARGET_W, TARGET_H);
        cropRafId = requestAnimationFrame(drawCropFrame);
      };
      drawCropFrame();

      const croppedStream = cropCanvas.captureStream(30);

      const mimeType = getSupportedRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(croppedStream, { mimeType })
        : new MediaRecorder(croppedStream);
      const chunks: BlobPart[] = [];
      const actualStartedAt = new Date().toISOString();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => {
        params.onError("Recording failed. Please try again.");
      };

      const nextCapture: ActiveCapture = {
        recordingId,
        plannedStartedAt,
        exerciseId,
        recorder,
        actualStartedAt,
        stream,
        socket,
        samplerVideo,
        samplerCanvas,
        samplerIntervalId,
        analysisModeRef
      };

      analysisModeRef.current = "recording";

      recorder.onstop = async () => {
        cancelAnimationFrame(cropRafId);
        cropVideo.srcObject = null;
        croppedStream.getTracks().forEach((t) => t.stop());

        const stopMeta = stopMetaRef.current;
        const stoppedAt = stopMeta.stoppedAt ?? new Date().toISOString();
        const shouldSave = stopMeta.mode === "save";
        const blob =
          shouldSave && chunks.length > 0
            ? new Blob(chunks, {
                type: recorder.mimeType || mimeType || "video/webm"
              })
            : null;

        if (activeCaptureRef.current?.recordingId === recordingId) {
          teardownCapture(activeCaptureRef.current);
          activeCaptureRef.current = null;
          setActiveCapture(null);
        } else {
          teardownCapture(nextCapture);
        }

        resetLiveAnalysis();

        if (!shouldSave) {
          try {
            await deleteBackendRecording(recordingId);
            await params.refreshRecordingsFromServer(true);
          } catch {
            // Keep cancellation silent.
          }
          return;
        }

        if (!blob) {
          params.onError("The recording stopped before any video was captured.");
          return;
        }

        storeRecordingBlob({
          recordingId,
          blob,
          fallbackMimeType: recorder.mimeType || mimeType || "video/webm"
        });

        try {
          await uploadRecordingBlob(
            recordingId,
            blob,
            `${recordingId}.${blob.type.includes("mp4") ? "mp4" : "webm"}`
          );
          await markRecordingUploadComplete({
            recordingId,
            stoppedAt,
            durationSec: calculateDurationSec(actualStartedAt, stoppedAt)
          });
          params.dispatch({
            type: "MARK_RECORDING_UPLOADED",
            payload: { recordingId }
          });
          await params.refreshRecordingsFromServer(true);
        } catch (error) {
          params.onError(
            error instanceof Error
              ? error.message
              : "Recording saved locally, but backend upload failed."
          );
        }
      };

      clearCountdownPreview(false);
      activeCaptureRef.current = nextCapture;
      setActiveCapture(nextCapture);
      stopMetaRef.current = {
        mode: "save",
        stoppedAt: null
      };

      params.dispatch({
        type: "START_RECORDING",
        payload: {
          recordingId,
          startedAt: actualStartedAt,
          exerciseId
        }
      });

      recorder.start(250);
      await params.refreshRecordingsFromServer(true);
    } catch (error) {
      params.onError(error instanceof Error ? error.message : "Unable to start recording.");
      await deleteBackendRecording(recordingId).catch(() => {});
      teardownCapture(preparedCapture);
      clearCountdownPreview(false);
      stopActiveStream();
    }
  };

  const startRecording = async () => {
    if (
      !params.activeUser ||
      isPreparingCamera ||
      activeCaptureRef.current ||
      countdownCaptureRef.current
    ) {
      return;
    }

    if (!params.selectedExerciseId) {
      return;
    }

    params.onError(null);
    setIsPreparingCamera(true);
    resetLiveAnalysis();

    let provisionalStream: MediaStream | null = null;

    try {
      const backendReady = await params.verifyBackendConnection(true);
      if (!backendReady) {
        return;
      }

      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        throw new Error("Camera access is not available in this browser.");
      }

      if (typeof MediaRecorder === "undefined") {
        throw new Error("Video recording is not supported in this browser.");
      }

      provisionalStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: {
            ideal: 1080
          },
          height: {
            ideal: 1920
          },
          aspectRatio: {
            ideal: 9 / 16
          },
          facingMode: {
            ideal: "environment"
          }
        },
        audio: false
      });

      const countdownStream = provisionalStream;
      const plannedStartedAt = new Date(Date.now() + 3000).toISOString();
      const session = await createRecordingSession({
        deviceId: params.deviceSession.deviceId,
        deviceName: params.deviceSession.deviceName,
        zoneName: params.deviceSession.zoneName,
        userId: params.activeUser.userId,
        userName: params.activeUser.userName,
        phoneNumber: params.activeUser.phoneNumber,
        selectedExercise: params.selectedExerciseId,
        startedAt: plannedStartedAt
      });
      const analysisModeRef: CaptureBase["analysisModeRef"] = {
        current: "calibration"
      };
      const liveResources = await attachLiveAnalysisSocket(
        countdownStream,
        session.live_analysis_ws_url,
        analysisModeRef
      );

      const nextCountdownCapture: CountdownCapture = {
        recordingId: session.recording_id,
        plannedStartedAt,
        exerciseId: params.selectedExerciseId,
        stream: countdownStream,
        socket: liveResources.socket,
        samplerVideo: liveResources.samplerVideo,
        samplerCanvas: liveResources.samplerCanvas,
        samplerIntervalId: liveResources.samplerIntervalId,
        analysisModeRef
      };

      const token = countdownTokenRef.current + 1;
      countdownTokenRef.current = token;
      countdownCaptureRef.current = nextCountdownCapture;
      setCountdownCapture(nextCountdownCapture);
      setCountdownSec(3);
      setIsPreparingCamera(false);

      const stepCountdown = (nextValue: number) => {
        if (countdownTokenRef.current !== token) {
          return;
        }

        if (nextValue === 0) {
          setCountdownSec(0);
          void startActualRecording(nextCountdownCapture);
          return;
        }

        setCountdownSec(nextValue);
        countdownTimeoutRef.current = window.setTimeout(() => {
          stepCountdown(nextValue - 1);
        }, 1000);
      };

      stepCountdown(3);
      provisionalStream = null;
    } catch (error) {
      params.onError(error instanceof Error ? error.message : "Unable to access the camera.");
      provisionalStream?.getTracks().forEach((track) => track.stop());
      clearCountdownPreview(false);
      stopActiveStream();
    } finally {
      setIsPreparingCamera(false);
    }
  };

  const stopRecording = () => {
    if (!activeCaptureRef.current || !params.currentRecording) {
      return;
    }

    const stoppedAt = new Date().toISOString();
    stopMetaRef.current = {
      mode: "save",
      stoppedAt
    };

    if (activeCaptureRef.current.recorder.state !== "inactive") {
      activeCaptureRef.current.recorder.stop();
    }

    params.dispatch({
      type: "STOP_RECORDING",
      payload: { stoppedAt }
    });
  };

  const cancelRecording = () => {
    if (countdownCaptureRef.current && !activeCaptureRef.current) {
      const pendingCapture = countdownCaptureRef.current;
      clearCountdownPreview();
      resetLiveAnalysis();
      void deleteBackendRecording(pendingCapture.recordingId).catch(() => {});
      return;
    }

    if (!activeCaptureRef.current) {
      return;
    }

    const stoppedAt = new Date().toISOString();
    stopMetaRef.current = {
      mode: "cancel",
      stoppedAt
    };

    if (activeCaptureRef.current.recorder.state !== "inactive") {
      activeCaptureRef.current.recorder.stop();
    }

    params.dispatch({
      type: "CANCEL_RECORDING",
      payload: { stoppedAt }
    });
  };

  const resetRecordingSession = () => {
    const pendingCountdownCapture = countdownCaptureRef.current;

    stopMetaRef.current = {
      mode: "cancel",
      stoppedAt: new Date().toISOString()
    };

    if (activeCaptureRef.current && activeCaptureRef.current.recorder.state !== "inactive") {
      activeCaptureRef.current.recorder.stop();
    }

    stopActiveStream();
    clearCountdownPreview();

    if (pendingCountdownCapture && !activeCaptureRef.current) {
      void deleteBackendRecording(pendingCountdownCapture.recordingId).catch(() => {});
    }

    clearRecordingAssets();
    resetLiveAnalysis();
    setIsPreparingCamera(false);
  };

  return {
    isPreparingCamera,
    recordingAssets,
    liveAnalysis,
    liveAnalysisState,
    activeCapture,
    countdownCapture,
    countdownSec,
    startRecording,
    stopRecording,
    cancelRecording,
    resetRecordingSession,
    clearRecordingAssets,
    deleteRecordingAsset
  };
}
