import { useEffect, useMemo, useRef, useState } from "react";
import {
  absoluteAssetUrl,
  BACKEND_OFFLINE_MESSAGE,
  BackendRecordingItem,
  checkBackendHealth,
  createRecordingSession,
  deleteBackendRecording,
  listBackendRecordings,
  LiveAnalysisUpdate,
  mapAnalysisResult,
  markRecordingUploadComplete,
  toWebSocketUrl,
  uploadRecordingBlob
} from "./api/analysisApi";
import { AnalysisPage, UploadedAnalysisFile } from "./components/AnalysisPage";
import { AuthModal } from "./components/AuthModal";
import { DebugPanel } from "./components/DebugPanel";
import { IdleScreen } from "./components/IdleScreen";
import { PostRecordingScreen } from "./components/PostRecordingScreen";
import { RecordingsModal } from "./components/RecordingsModal";
import { ReadyScreen } from "./components/ReadyScreen";
import { RecordingScreen } from "./components/RecordingScreen";
import { SelectUserScreen } from "./components/SelectUserScreen";
import { TemplatesModal } from "./components/TemplatesModal";
import { TermsScreen } from "./components/TermsScreen";
import { renderVideoTemplate } from "./editing/videoTemplates";
import { isSupportedExerciseId } from "./exerciseCatalog";
import { useInactivityTimeout } from "./hooks/useInactivityTimeout";
import { usePersistentReducer } from "./hooks/usePersistentReducer";
import { createInitialState, STORAGE_KEY } from "./mockData";
import { kioskReducer } from "./reducer/kioskReducer";
import {
  Recording,
  RecordingLibraryItem,
  SupportedExerciseId,
  VideoTemplateId
} from "./types";

type RecordingAsset = {
  url: string;
  mimeType: string;
};

type EditedRecordingAsset = {
  templateId: VideoTemplateId;
  templateName: string;
  url: string;
  mimeType: string;
  createdAt: string;
};

type AppRoute = "kiosk" | "analysis";

type StopMode = "save" | "cancel";

type StopMeta = {
  mode: StopMode;
  stoppedAt: string | null;
};

type LiveAnalysisMode = "calibration" | "recording";

type CaptureBase = {
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

type ActiveCapture = CaptureBase & {
  recorder: MediaRecorder;
  actualStartedAt: string;
};

type CountdownCapture = CaptureBase;

type TemplateProcessingState = {
  recordingId: string;
  templateId: VideoTemplateId;
  progress: number;
  message: string;
  error: string | null;
};

const SERVER_SYNC_STATUSES = new Set(["recording", "processing", "uploading"]);

function createClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function getCurrentRoute(): AppRoute {
  if (typeof window === "undefined") {
    return "kiosk";
  }

  return window.location.pathname === "/analysis" ? "analysis" : "kiosk";
}

function calculateDurationSec(startedAt: string, stoppedAt: string): number {
  return Math.max(
    1,
    Math.floor((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  );
}

function buildRecordingLibraryItems(params: {
  localRecordings: Recording[];
  serverRecordings: BackendRecordingItem[];
  recordingAssets: Record<string, RecordingAsset>;
  editedRecordingAssets: Record<string, EditedRecordingAsset>;
  deviceName: string;
  zoneName: string;
}): RecordingLibraryItem[] {
  const merged = new Map<string, RecordingLibraryItem>();

  params.localRecordings.forEach((recording) => {
    const localAsset = params.recordingAssets[recording.id];
    const liveRepEvents = recording.liveRepEvents ?? [];
    merged.set(recording.id, {
      id: recording.id,
      userName: recording.userName,
      deviceName: params.deviceName,
      zoneName: params.zoneName,
      startedAt: recording.startedAt,
      stoppedAt: recording.stoppedAt,
      durationSec: recording.durationSec,
      status: recording.status,
      playbackUrl: localAsset?.url ?? null,
      mimeType: localAsset?.mimeType ?? null,
      editedVersion: params.editedRecordingAssets[recording.id]
        ? {
            templateId: params.editedRecordingAssets[recording.id].templateId,
            templateName: params.editedRecordingAssets[recording.id].templateName,
            playbackUrl: params.editedRecordingAssets[recording.id].url,
            mimeType: params.editedRecordingAssets[recording.id].mimeType,
            createdAt: params.editedRecordingAssets[recording.id].createdAt
          }
        : null,
      analysisResult: null,
      templateRepEvents: liveRepEvents,
      templateRepCount: liveRepEvents.length,
      templateTimingSource: liveRepEvents.length > 0 ? "live" : "none"
    });
  });

  params.serverRecordings.forEach((recording) => {
    const previous = merged.get(recording.id);
    const localAsset = params.recordingAssets[recording.id];
    const analysisResult = mapAnalysisResult(recording.latest_result);
    const liveRepEvents = previous?.templateRepEvents ?? [];
    const hasFinalRepEvents = (analysisResult?.repEvents.length ?? 0) > 0;
    const hasEstimatedFinalRepCount = !hasFinalRepEvents && (analysisResult?.repCount ?? 0) > 0;
    const templateRepEvents = hasFinalRepEvents
      ? analysisResult?.repEvents ?? []
      : liveRepEvents;
    const templateRepCount = hasFinalRepEvents
      ? analysisResult?.repEvents.length ?? 0
      : hasEstimatedFinalRepCount
        ? analysisResult?.repCount ?? 0
        : liveRepEvents.length;
    const templateTimingSource: RecordingLibraryItem["templateTimingSource"] = hasFinalRepEvents
      ? "final"
      : hasEstimatedFinalRepCount
        ? "estimated"
        : liveRepEvents.length > 0
          ? "live"
          : "none";
    merged.set(recording.id, {
      id: recording.id,
      userName: recording.user_name,
      deviceName: recording.device_name,
      zoneName: recording.zone_name,
      startedAt: recording.started_at,
      stoppedAt: recording.stopped_at,
      durationSec: recording.duration_sec,
      status: recording.status,
      playbackUrl: localAsset?.url ?? absoluteAssetUrl(recording.asset_url),
      mimeType: localAsset?.mimeType ?? recording.mime_type,
      editedVersion:
        params.editedRecordingAssets[recording.id]
          ? {
              templateId: params.editedRecordingAssets[recording.id].templateId,
              templateName: params.editedRecordingAssets[recording.id].templateName,
              playbackUrl: params.editedRecordingAssets[recording.id].url,
              mimeType: params.editedRecordingAssets[recording.id].mimeType,
              createdAt: params.editedRecordingAssets[recording.id].createdAt
            }
          : previous?.editedVersion ?? null,
      analysisResult: analysisResult ?? previous?.analysisResult ?? null,
      templateRepEvents,
      templateRepCount,
      templateTimingSource
    });
  });

  return Array.from(merged.values()).sort(
    (left, right) =>
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}

export default function App() {
  const [state, dispatch] = usePersistentReducer(
    kioskReducer,
    createInitialState(),
    STORAGE_KEY
  );
  const [route, setRoute] = useState<AppRoute>(getCurrentRoute);
  const [authModalMode, setAuthModalMode] = useState<"scan" | "add" | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isRecordingsOpen, setIsRecordingsOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isPreparingCamera, setIsPreparingCamera] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">(
    "checking"
  );
  const [recordingAssets, setRecordingAssets] = useState<Record<string, RecordingAsset>>({});
  const [editedRecordingAssets, setEditedRecordingAssets] = useState<
    Record<string, EditedRecordingAsset>
  >({});
  const [uploadedAnalysisFiles, setUploadedAnalysisFiles] = useState<UploadedAnalysisFile[]>([]);
  const [serverRecordings, setServerRecordings] = useState<BackendRecordingItem[]>([]);
  const [liveAnalysis, setLiveAnalysis] = useState<LiveAnalysisUpdate | null>(null);
  const [liveAnalysisState, setLiveAnalysisState] = useState<
    "idle" | "connecting" | "live" | "offline"
  >("idle");
  const [activeCapture, setActiveCapture] = useState<ActiveCapture | null>(null);
  const [countdownCapture, setCountdownCapture] = useState<CountdownCapture | null>(null);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const [templateProcessingState, setTemplateProcessingState] =
    useState<TemplateProcessingState | null>(null);
  const activeCaptureRef = useRef<ActiveCapture | null>(null);
  const countdownCaptureRef = useRef<CountdownCapture | null>(null);
  const countdownTimeoutRef = useRef<number | null>(null);
  const countdownTokenRef = useRef(0);
  const recordingAssetsRef = useRef<Record<string, RecordingAsset>>({});
  const editedRecordingAssetsRef = useRef<Record<string, EditedRecordingAsset>>({});
  const uploadedAnalysisFilesRef = useRef<UploadedAnalysisFile[]>([]);
  const stopMetaRef = useRef<StopMeta>({
    mode: "save",
    stoppedAt: null
  });

  const activeUser = useMemo(
    () =>
      state.deviceSession.authenticatedUsers.find(
        (user) => user.sessionUserId === state.deviceSession.activeUserId
      ) ?? null,
    [state.deviceSession.activeUserId, state.deviceSession.authenticatedUsers]
  );

  const selectedExerciseId = useMemo<SupportedExerciseId | null>(
    () => (isSupportedExerciseId(state.selectedExerciseId) ? state.selectedExerciseId : null),
    [state.selectedExerciseId]
  );

  const currentRecording = useMemo(
    () =>
      state.deviceSession.recordings.find(
        (recording) => recording.id === state.currentRecordingId
      ) ?? null,
    [state.currentRecordingId, state.deviceSession.recordings]
  );

  const latestRecording = useMemo(
    () =>
      state.deviceSession.recordings.find(
        (recording) => recording.id === state.lastCompletedRecordingId
      ) ?? null,
    [state.deviceSession.recordings, state.lastCompletedRecordingId]
  );

  const shouldShowRecordingScreen =
    route === "kiosk" &&
    !!activeUser &&
    ((countdownCapture && countdownSec !== null) ||
      (state.view === "recording" && currentRecording));

  const otherAuthenticatedUsers = useMemo(
    () =>
      state.deviceSession.authenticatedUsers.filter(
        (user) => user.sessionUserId !== state.deviceSession.activeUserId
      ),
    [state.deviceSession.activeUserId, state.deviceSession.authenticatedUsers]
  );

  const pendingTermsUser = useMemo(
    () =>
      state.deviceSession.authenticatedUsers.find(
        (user) => user.sessionUserId === state.pendingTermsSessionUserId
      ) ?? null,
    [state.deviceSession.authenticatedUsers, state.pendingTermsSessionUserId]
  );

  const recordingLibraryItems = useMemo(
    () =>
      buildRecordingLibraryItems({
        localRecordings: state.deviceSession.recordings,
        serverRecordings,
        recordingAssets,
        editedRecordingAssets,
        deviceName: state.deviceSession.deviceName,
        zoneName: state.deviceSession.zoneName
      }),
    [
      editedRecordingAssets,
      recordingAssets,
      serverRecordings,
      state.deviceSession.deviceName,
      state.deviceSession.recordings,
      state.deviceSession.zoneName
    ]
  );

  const latestRecordingLibraryItem = useMemo(
    () =>
      latestRecording
        ? recordingLibraryItems.find((recording) => recording.id === latestRecording.id) ?? null
        : null,
    [latestRecording, recordingLibraryItems]
  );

  useEffect(() => {
    if (state.view !== "recording" || !state.currentRecordingId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      dispatch({
        type: "TICK_RECORDING",
        payload: { now: new Date().toISOString() }
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [dispatch, state.currentRecordingId, state.view]);

  useEffect(() => {
    recordingAssetsRef.current = recordingAssets;
  }, [recordingAssets]);

  useEffect(() => {
    editedRecordingAssetsRef.current = editedRecordingAssets;
  }, [editedRecordingAssets]);

  useEffect(() => {
    if (state.view !== "recording" || !currentRecording || !liveAnalysis) {
      return;
    }

    const nextRepCount = Math.max(0, liveAnalysis.rep_count ?? 0);
    const existingRepEvents = currentRecording.liveRepEvents ?? [];
    const currentRepCount = existingRepEvents.length;

    if (nextRepCount <= currentRepCount) {
      return;
    }

    const startedAtMs = new Date(currentRecording.startedAt).getTime();
    const eventBaseTimestampMs = Math.max(0, Date.now() - startedAtMs);
    const nextEvents = [...existingRepEvents];
    const newRepCount = nextRepCount - currentRepCount;

    for (let offset = 0; offset < newRepCount; offset += 1) {
      const repIndex = currentRepCount + offset + 1;
      nextEvents.push({
        repIndex,
        timestampMs: Math.max(0, eventBaseTimestampMs - (newRepCount - offset - 1) * 140),
        qualityScore: 82,
        notes: "Captured from live rep tracking during recording."
      });
    }

    dispatch({
      type: "SYNC_RECORDING_LIVE_REP_EVENTS",
      payload: {
        recordingId: currentRecording.id,
        repEvents: nextEvents
      }
    });
  }, [currentRecording, liveAnalysis, state.view]);

  useEffect(() => {
    uploadedAnalysisFilesRef.current = uploadedAnalysisFiles;
  }, [uploadedAnalysisFiles]);

  useEffect(() => {
    countdownCaptureRef.current = countdownCapture;
  }, [countdownCapture]);

  const teardownCapture = (capture: CaptureBase | ActiveCapture | null) => {
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
  };

  const stopActiveStream = () => {
    if (activeCaptureRef.current) {
      teardownCapture(activeCaptureRef.current);
      activeCaptureRef.current = null;
      setActiveCapture(null);
    }

    setLiveAnalysis(null);
    setLiveAnalysisState("idle");
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

  const clearRecordingAssets = () => {
    Object.values(recordingAssetsRef.current).forEach((asset) => {
      URL.revokeObjectURL(asset.url);
    });
    setRecordingAssets({});
  };

  const clearEditedRecordingAssets = () => {
    Object.values(editedRecordingAssetsRef.current).forEach((asset) => {
      URL.revokeObjectURL(asset.url);
    });
    setEditedRecordingAssets({});
  };

  const clearUploadedAnalysisFiles = () => {
    uploadedAnalysisFilesRef.current.forEach((file) => {
      URL.revokeObjectURL(file.url);
    });
    setUploadedAnalysisFiles([]);
  };

  const verifyBackendConnection = async (showError = false): Promise<boolean> => {
    try {
      await checkBackendHealth();
      setBackendStatus("online");
      return true;
    } catch (error) {
      setBackendStatus("offline");
      if (showError) {
        setCameraError(
          error instanceof Error ? error.message : BACKEND_OFFLINE_MESSAGE
        );
      }
      return false;
    }
  };

  const refreshRecordingsFromServer = async (silent = false) => {
    try {
      const recordings = await listBackendRecordings();
      setServerRecordings(recordings);
      setBackendStatus("online");
    } catch (error) {
      setBackendStatus("offline");
      if (!silent) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not refresh recordings from the analysis service.";
        setCameraError(message);
      }
    }
  };

  useEffect(() => {
    return () => {
      Object.values(recordingAssetsRef.current).forEach((asset) => {
        URL.revokeObjectURL(asset.url);
      });

      Object.values(editedRecordingAssetsRef.current).forEach((asset) => {
        URL.revokeObjectURL(asset.url);
      });

      uploadedAnalysisFilesRef.current.forEach((file) => {
        URL.revokeObjectURL(file.url);
      });

      clearCountdownPreview();

      if (activeCaptureRef.current) {
        teardownCapture(activeCaptureRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void verifyBackendConnection(false);
    void refreshRecordingsFromServer(true);
  }, []);

  useEffect(() => {
    if (route !== "analysis" && !isRecordingsOpen) {
      return;
    }

    void refreshRecordingsFromServer(true);
  }, [isRecordingsOpen, route]);

  useEffect(() => {
    const shouldPoll = serverRecordings.some((recording) =>
      SERVER_SYNC_STATUSES.has(recording.status)
    );

    if (!shouldPoll) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRecordingsFromServer(true);
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [serverRecordings]);

  useEffect(() => {
    const handlePopState = () => setRoute(getCurrentRoute());
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!shouldShowRecordingScreen || typeof window === "undefined") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: "auto"
      });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [shouldShowRecordingScreen]);

  const { remainingWarningSec } = useInactivityTimeout({
    enabled: state.inactivity.enabled,
    isRecording: state.view === "recording",
    hasAuthenticatedUsers: state.deviceSession.authenticatedUsers.length > 0,
    idleTimeoutSec: state.inactivity.idleTimeoutSec,
    warningCountdownSec: state.inactivity.warningCountdownSec,
    warningStartedAt: state.inactivity.warningStartedAt,
    onShowWarning: () =>
      dispatch({
        type: "SHOW_INACTIVITY_WARNING",
        payload: { startedAt: new Date().toISOString() }
      }),
    onHideWarning: () => dispatch({ type: "HIDE_INACTIVITY_WARNING" }),
    onReset: () => dispatch({ type: "RESET_DEVICE" })
  });

  const closeAuthModal = () => setAuthModalMode(null);

  const navigateTo = (nextRoute: AppRoute) => {
    const nextPath = nextRoute === "analysis" ? "/analysis" : "/";
    window.history.pushState({}, "", nextPath);
    setRoute(nextRoute);
  };

  const handleResetDevice = () => {
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
    clearEditedRecordingAssets();
    clearUploadedAnalysisFiles();
    setCameraError(null);
    setIsPreparingCamera(false);
    setIsRecordingsOpen(false);
    setIsTemplatesOpen(false);
    setTemplateProcessingState(null);
    dispatch({ type: "RESET_DEVICE" });
  };

  const handlePhoneSubmit = (phone: string) => {
    const connectedUserIds = new Set(
      state.deviceSession.authenticatedUsers.map((user) => user.userId)
    );
    const availableUsers = state.knownUsers.filter((user) => !connectedUserIds.has(user.id));
    const numericValue = phone
      .split("")
      .reduce((sum, digit) => sum + Number.parseInt(digit, 10), 0);

    if (availableUsers.length > 0) {
      const randomUser = availableUsers[numericValue % availableUsers.length];
      dispatch({ type: "AUTHENTICATE_USER", payload: { user: randomUser } });
    } else {
      const fallbackNames = [
        "Rohan",
        "Ananya",
        "Vikram",
        "Priya",
        "Kunal",
        "Ira",
        "Siddharth",
        "Tara"
      ];
      const name = fallbackNames[numericValue % fallbackNames.length];
      dispatch({ type: "CREATE_AND_AUTHENTICATE_USER", payload: { name } });
    }

    closeAuthModal();
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
        // Preview in the visible UI still works; live analysis will begin once frames can play.
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

    if (!activeUser) {
      teardownCapture(preparedCapture);
      clearCountdownPreview(false);
      void deleteBackendRecording(recordingId).catch(() => {});
      return;
    }

    try {
      const mimeType = getSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      const actualStartedAt = new Date().toISOString();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => {
        setCameraError("Recording failed. Please try again.");
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

        setLiveAnalysis(null);
        setLiveAnalysisState("idle");

        if (!shouldSave) {
          try {
            await deleteBackendRecording(recordingId);
            await refreshRecordingsFromServer(true);
          } catch {
            // Cancel should stay quiet if the backend recording was never finalized.
          }
          return;
        }

        if (!blob) {
          setCameraError("The recording stopped before any video was captured.");
          return;
        }

        const localUrl = URL.createObjectURL(blob);
        setRecordingAssets((current) => {
          const previous = current[recordingId];
          if (previous) {
            URL.revokeObjectURL(previous.url);
          }

          return {
            ...current,
            [recordingId]: {
              url: localUrl,
              mimeType: blob.type || recorder.mimeType || mimeType || "video/webm"
            }
          };
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
          dispatch({
            type: "MARK_RECORDING_UPLOADED",
            payload: { recordingId }
          });
          await refreshRecordingsFromServer(true);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Recording saved locally, but backend upload failed.";
          setCameraError(message);
        }
      };

      clearCountdownPreview(false);
      activeCaptureRef.current = nextCapture;
      setActiveCapture(nextCapture);
      stopMetaRef.current = {
        mode: "save",
        stoppedAt: null
      };

      dispatch({
        type: "START_RECORDING",
        payload: {
          recordingId,
          startedAt: actualStartedAt,
          exerciseId
        }
      });

      recorder.start(250);
      await refreshRecordingsFromServer(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start recording.";
      setCameraError(message);
      await deleteBackendRecording(recordingId).catch(() => {});
      teardownCapture(preparedCapture);
      clearCountdownPreview(false);
      stopActiveStream();
    }
  };

  const startRecording = async () => {
    if (!activeUser || isPreparingCamera || activeCaptureRef.current || countdownCaptureRef.current) {
      return;
    }

    if (!selectedExerciseId) {
      return;
    }

    setCameraError(null);
    setIsPreparingCamera(true);
    setLiveAnalysis(null);
    setLiveAnalysisState("idle");

    let provisionalStream: MediaStream | null = null;

    try {
      const backendReady = await verifyBackendConnection(true);
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
          facingMode: {
            ideal: "environment"
          }
        },
        audio: false
      });
      const countdownStream = provisionalStream;
      const plannedStartedAt = new Date(Date.now() + 3000).toISOString();
      const session = await createRecordingSession({
        deviceId: state.deviceSession.deviceId,
        deviceName: state.deviceSession.deviceName,
        zoneName: state.deviceSession.zoneName,
        userId: activeUser.userId,
        userName: activeUser.userName,
        selectedExercise: selectedExerciseId,
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
        exerciseId: selectedExerciseId,
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
      const message =
        error instanceof Error ? error.message : "Unable to access the camera.";
      setCameraError(message);
      provisionalStream?.getTracks().forEach((track) => track.stop());
      clearCountdownPreview(false);
      stopActiveStream();
    } finally {
      setIsPreparingCamera(false);
    }
  };

  const stopRecording = () => {
    if (!activeCaptureRef.current || !currentRecording) {
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

    dispatch({
      type: "STOP_RECORDING",
      payload: { stoppedAt }
    });
  };

  const cancelRecording = () => {
    if (countdownCaptureRef.current && !activeCaptureRef.current) {
      const pendingCapture = countdownCaptureRef.current;
      clearCountdownPreview();
      setLiveAnalysis(null);
      setLiveAnalysisState("idle");
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

    dispatch({
      type: "CANCEL_RECORDING",
      payload: { stoppedAt }
    });
  };

  const deleteRecording = async (recordingId: string) => {
    const existingAsset = recordingAssetsRef.current[recordingId];
    if (existingAsset) {
      URL.revokeObjectURL(existingAsset.url);
      setRecordingAssets((current) => {
        const next = { ...current };
        delete next[recordingId];
        return next;
      });
    }

    const editedAsset = editedRecordingAssetsRef.current[recordingId];
    if (editedAsset) {
      URL.revokeObjectURL(editedAsset.url);
      setEditedRecordingAssets((current) => {
        const next = { ...current };
        delete next[recordingId];
        return next;
      });
    }

    dispatch({
      type: "DELETE_RECORDING",
      payload: { recordingId }
    });

    try {
      await deleteBackendRecording(recordingId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not delete the recording from backend.";
      if (!message.includes("404")) {
        setCameraError(message);
      }
    } finally {
      await refreshRecordingsFromServer(true);
    }
  };

  const uploadAnalysisFiles = (files: FileList | null) => {
    if (!files) {
      return;
    }

    const nextFiles = Array.from(files)
      .filter((file) => file.type.startsWith("video/"))
      .map((file) => ({
        id: createClientId("upload"),
        name: file.name,
        url: URL.createObjectURL(file),
        mimeType: file.type || "video/mp4",
        size: file.size,
        file
      }));

    if (nextFiles.length === 0) {
      return;
    }

    setUploadedAnalysisFiles((current) => [...nextFiles, ...current]);
  };

  const deleteUploadedAnalysisFile = (fileId: string) => {
    const file = uploadedAnalysisFilesRef.current.find((item) => item.id === fileId);
    if (file) {
      URL.revokeObjectURL(file.url);
    }

    setUploadedAnalysisFiles((current) => current.filter((item) => item.id !== fileId));
  };

  const applyTemplateToRecording = async (
    recordingId: string,
    templateId: VideoTemplateId
  ) => {
    const targetRecording =
      recordingLibraryItems.find((recording) => recording.id === recordingId) ?? null;

    if (!targetRecording?.playbackUrl) {
      setCameraError("This recording is not available for editing in the current browser.");
      return;
    }

    setCameraError(null);
    setTemplateProcessingState({
      recordingId,
      templateId,
      progress: 0.02,
      message: "Preparing your template...",
      error: null
    });

    try {
      const rendered = await renderVideoTemplate({
        sourceUrl: targetRecording.playbackUrl,
        templateId,
        repEvents: targetRecording.templateRepEvents,
        repCount: targetRecording.templateRepCount,
        durationSec: targetRecording.durationSec,
        onProgress: ({ progress, message }) => {
          setTemplateProcessingState((current) =>
            current && current.recordingId === recordingId && current.templateId === templateId
              ? {
                  ...current,
                  progress,
                  message,
                  error: null
                }
              : current
          );
        }
      });

      const nextUrl = URL.createObjectURL(rendered.blob);
      setEditedRecordingAssets((current) => {
        const previous = current[recordingId];
        if (previous) {
          URL.revokeObjectURL(previous.url);
        }

        return {
          ...current,
          [recordingId]: {
            templateId: rendered.templateId,
            templateName: rendered.templateName,
            url: nextUrl,
            mimeType: rendered.mimeType,
            createdAt: new Date().toISOString()
          }
        };
      });

      setTemplateProcessingState({
        recordingId,
        templateId,
        progress: 1,
        message: "Edited video ready.",
        error: null
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The template could not be applied.";
      setTemplateProcessingState({
        recordingId,
        templateId,
        progress: 1,
        message: "Template render failed.",
        error: message
      });
      setCameraError(message);
    }
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <button className="reset-toggle" onClick={handleResetDevice} type="button">
        Start Over
      </button>

      <button
        className="analysis-toggle"
        onClick={() => navigateTo(route === "analysis" ? "kiosk" : "analysis")}
        type="button"
      >
        {route === "analysis" ? "Kiosk" : "Analysis"}
      </button>

      <button
        className="recordings-toggle"
        onClick={() => setIsRecordingsOpen(true)}
        type="button"
      >
        Recordings
      </button>

      <button className="debug-toggle" onClick={() => setIsDebugOpen(true)} type="button">
        Debug
      </button>

      <main className="kiosk-frame">
        {route === "analysis" ? (
          <AnalysisPage
            recordings={recordingLibraryItems}
            uploadedFiles={uploadedAnalysisFiles}
            onUploadFiles={uploadAnalysisFiles}
            onDeleteRecording={(recordingId) => void deleteRecording(recordingId)}
            onDeleteUploadedFile={deleteUploadedAnalysisFile}
            onRefreshRecordings={() => refreshRecordingsFromServer(true)}
          />
        ) : null}

        {route === "kiosk" && state.view === "idle" ? (
          <IdleScreen
            deviceName={state.deviceSession.deviceName}
            zoneName={state.deviceSession.zoneName}
            authenticatedUsers={state.deviceSession.authenticatedUsers}
            activeUser={activeUser}
            onSubmitPhone={handlePhoneSubmit}
          />
        ) : null}

        {route === "kiosk" && state.view === "selectUser" ? (
          <SelectUserScreen
            authenticatedUsers={state.deviceSession.authenticatedUsers}
            onSelectUser={(sessionUserId) =>
              dispatch({ type: "SELECT_ACTIVE_USER", payload: { sessionUserId } })
            }
            onAddNewUser={() => setAuthModalMode("add")}
          />
        ) : null}

        {route === "kiosk" && state.view === "terms" && pendingTermsUser ? (
          <TermsScreen
            user={pendingTermsUser}
            onProceed={() => dispatch({ type: "ACCEPT_TERMS" })}
          />
        ) : null}

        {route === "kiosk" && state.view === "ready" && activeUser ? (
          <ReadyScreen
            activeUser={activeUser}
            authenticatedUsers={state.deviceSession.authenticatedUsers}
            isBackendOnline={backendStatus === "online"}
            selectedExerciseId={selectedExerciseId}
            onStartRecording={startRecording}
            onSelectConnectedUser={(sessionUserId) =>
              dispatch({ type: "SELECT_ACTIVE_USER", payload: { sessionUserId } })
            }
            onSelectExercise={(exerciseId) =>
              dispatch({
                type: "SELECT_EXERCISE_FOR_NEXT_SET",
                payload: { exerciseId }
              })
            }
            onAddNewUser={() => setAuthModalMode("add")}
            onEndActiveUser={() => dispatch({ type: "END_ACTIVE_USER" })}
          />
        ) : null}

        {shouldShowRecordingScreen && activeUser ? (
          <RecordingScreen
            activeUser={activeUser}
            recording={currentRecording}
            selectedExerciseId={currentRecording?.exerciseId ?? selectedExerciseId}
            previewStream={activeCapture?.stream ?? countdownCapture?.stream ?? null}
            liveAnalysis={liveAnalysis}
            liveAnalysisState={liveAnalysisState}
            countdownSec={countdownSec}
            onStopRecording={stopRecording}
            onCancelRecording={cancelRecording}
          />
        ) : null}

        {route === "kiosk" && state.view === "postRecording" && latestRecording ? (
          <PostRecordingScreen
            activeUser={activeUser}
            latestRecording={latestRecording}
            latestRecordingItem={latestRecordingLibraryItem}
            otherUsers={otherAuthenticatedUsers}
            isBackendOnline={backendStatus === "online"}
            selectedExerciseId={selectedExerciseId}
            onRecordNextSet={startRecording}
            onEndActiveUser={() => dispatch({ type: "END_ACTIVE_USER" })}
            onAddNewUser={() => setAuthModalMode("add")}
            onSelectExercise={(exerciseId) =>
              dispatch({
                type: "SELECT_EXERCISE_FOR_NEXT_SET",
                payload: { exerciseId }
              })
            }
            onOpenTemplates={() => setIsTemplatesOpen(true)}
            onSwitchUser={(sessionUserId) =>
              dispatch({ type: "SELECT_ACTIVE_USER", payload: { sessionUserId } })
            }
            isTemplateProcessing={
              templateProcessingState?.recordingId === latestRecording.id &&
              !templateProcessingState.error &&
              templateProcessingState.progress < 1
            }
          />
        ) : null}
      </main>

      {state.inactivity.warningStartedAt ? (
        <div className="warning-toast">
          <strong>Device idle</strong>
          <span>
            Session will reset in {remainingWarningSec}s unless someone interacts with the
            screen.
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => dispatch({ type: "HIDE_INACTIVITY_WARNING" })}
          >
            Stay Signed In
          </button>
        </div>
      ) : null}

      {cameraError ? <div className="camera-error-toast">{cameraError}</div> : null}

      {isPreparingCamera ? (
        <div className="camera-loading-toast">Starting camera and backend session...</div>
      ) : null}

      <AuthModal
        open={authModalMode !== null}
        mode={authModalMode ?? "scan"}
        onClose={closeAuthModal}
        onSubmitPhone={handlePhoneSubmit}
      />

      <RecordingsModal
        open={isRecordingsOpen}
        recordings={recordingLibraryItems}
        onDeleteRecording={(recordingId) => void deleteRecording(recordingId)}
        onClose={() => setIsRecordingsOpen(false)}
      />

      <TemplatesModal
        open={isTemplatesOpen}
        recording={latestRecordingLibraryItem}
        editedVersion={latestRecordingLibraryItem?.editedVersion ?? null}
        processingState={templateProcessingState}
        onApplyTemplate={(templateId) => {
          if (latestRecordingLibraryItem) {
            void applyTemplateToRecording(latestRecordingLibraryItem.id, templateId);
          }
        }}
        onClose={() => setIsTemplatesOpen(false)}
      />

      <DebugPanel
        open={isDebugOpen}
        state={state}
        remainingWarningSec={remainingWarningSec}
        onClose={() => setIsDebugOpen(false)}
        onToggleTimeout={(enabled) =>
          dispatch({ type: "SET_TIMEOUT_ENABLED", payload: { enabled } })
        }
        onResetDevice={handleResetDevice}
      />
    </div>
  );
}
