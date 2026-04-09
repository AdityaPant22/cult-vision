import { useEffect, useMemo, useState } from "react";
import { deleteBackendRecording } from "./api/analysisApi";
import { useAppRoute } from "./app/router/useAppRoute";
import { AuthModal } from "./components/AuthModal";
import { DebugPanel } from "./components/DebugPanel";
import { RecordingsModal } from "./components/RecordingsModal";
import { TemplateWeightModal } from "./components/TemplateWeightModal";
import { TemplatesModal } from "./components/TemplatesModal";
import { getVideoTemplates, templateNeedsWeightInput } from "./editing/videoTemplates";
import { resolvePrototypePhoneAuth } from "./features/auth-by-phone/model/resolvePrototypePhoneAuth";
import { useUploadedAnalysisFiles } from "./features/analysis-uploads/model/useUploadedAnalysisFiles";
import {
  selectActiveUser,
  selectCurrentRecording,
  selectLatestRecording,
  selectOtherAuthenticatedUsers,
  selectPendingTermsUser,
  selectSelectedExerciseId
} from "./features/kiosk-session/model/selectors";
import { buildRecordingLibraryItems } from "./features/recording-library/model/buildRecordingLibraryItems";
import { useRecordingSession } from "./features/recording-session/model/useRecordingSession";
import { useBackendRecordings } from "./features/recordings-sync/model/useBackendRecordings";
import { useTemplateRendering } from "./features/video-templates/model/useTemplateRendering";
import { usePersistentReducer } from "./hooks/usePersistentReducer";
import { createInitialState, STORAGE_KEY } from "./mockData";
import { AnalysisWorkspacePage } from "./pages/AnalysisWorkspacePage";
import { KioskPage } from "./pages/KioskPage";
import { SetupPage } from "./pages/SetupPage";
import { kioskReducer } from "./reducer/kioskReducer";
import { VideoTemplateId } from "./types";

type PendingTemplateRender = {
  recordingId: string;
  templateId: VideoTemplateId;
  isRetry: boolean;
} | null;

function normalizeWeightKg(value: string) {
  return value.replace(/\D/g, "").trim();
}

export default function App() {
  const [state, dispatch] = usePersistentReducer(
    kioskReducer,
    createInitialState(),
    STORAGE_KEY
  );
  const { route, navigateTo } = useAppRoute();
  const [authModalMode, setAuthModalMode] = useState<"scan" | "add" | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isRecordingsOpen, setIsRecordingsOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pendingTemplateRender, setPendingTemplateRender] =
    useState<PendingTemplateRender>(null);

  const activeUser = useMemo(() => selectActiveUser(state), [state]);
  const selectedExerciseId = useMemo(() => selectSelectedExerciseId(state), [state]);
  const currentRecording = useMemo(() => selectCurrentRecording(state), [state]);
  const latestRecording = useMemo(() => selectLatestRecording(state), [state]);
  const otherAuthenticatedUsers = useMemo(
    () => selectOtherAuthenticatedUsers(state),
    [state]
  );
  const pendingTermsUser = useMemo(() => selectPendingTermsUser(state), [state]);

  const {
    backendStatus,
    serverRecordings,
    refreshRecordingsFromServer,
    verifyBackendConnection
  } = useBackendRecordings({
    route,
    isRecordingsOpen,
    onError: setCameraError
  });

  const {
    uploadedAnalysisFiles,
    uploadAnalysisFiles,
    deleteUploadedAnalysisFile,
    clearUploadedAnalysisFiles
  } = useUploadedAnalysisFiles();

  const {
    editedRecordingAssets,
    selectedTemplateIds,
    templateProcessingStates,
    queuedTemplateIdsByRecording,
    startTemplateRender,
    retryTemplateRender,
    selectTemplateForRecording,
    clearEditedRecordingAssets,
    deleteEditedRecordingAsset
  } = useTemplateRendering({
    onError: setCameraError
  });

  const {
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
    deleteRecordingAsset
  } = useRecordingSession({
    activeUser,
    selectedExerciseId,
    currentRecording,
    deviceSession: state.deviceSession,
    view: state.view,
    dispatch,
    onError: setCameraError,
    verifyBackendConnection,
    refreshRecordingsFromServer
  });

  const recordingLibraryItems = useMemo(
    () =>
      buildRecordingLibraryItems({
        localRecordings: state.deviceSession.recordings,
        serverRecordings,
        recordingAssets,
        editedRecordingAssets,
        selectedTemplateIds,
        deviceName: state.deviceSession.deviceName,
        zoneName: state.deviceSession.zoneName
      }),
    [
      editedRecordingAssets,
      recordingAssets,
      selectedTemplateIds,
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
  const hasQueuedTemplatesForLatestRecording = latestRecording?.id
    ? (queuedTemplateIdsByRecording[latestRecording.id]?.length ?? 0) > 0
    : false;
  const hasRenderingTemplatesForLatestRecording = latestRecording?.id
    ? Object.values(templateProcessingStates).some(
        (stateItem) =>
          stateItem.recordingId === latestRecording.id &&
          !stateItem.error &&
          stateItem.progress < 1
      )
    : false;
  const isTemplateProcessingForLatestRecording =
    hasQueuedTemplatesForLatestRecording || hasRenderingTemplatesForLatestRecording;

  const latestRecordingTemplateProcessingStates = useMemo(() => {
    if (!latestRecording?.id) {
      return {};
    }

    return Object.fromEntries(
      Object.values(templateProcessingStates)
        .filter((stateItem) => stateItem.recordingId === latestRecording.id)
        .map((stateItem) => [stateItem.templateId, stateItem])
    );
  }, [latestRecording?.id, templateProcessingStates]);

  const latestRecordingQueuedTemplateIds = useMemo(
    () => (latestRecording?.id ? queuedTemplateIdsByRecording[latestRecording.id] ?? [] : []),
    [latestRecording?.id, queuedTemplateIdsByRecording]
  );
  const pendingTemplateDefinition = useMemo(
    () =>
      pendingTemplateRender
        ? getVideoTemplates().find((template) => template.id === pendingTemplateRender.templateId) ??
          null
        : null,
    [pendingTemplateRender]
  );

  const shouldShowRecordingScreen =
    route === "kiosk" &&
    !!activeUser &&
    ((countdownCapture && countdownSec !== null) ||
      (state.view === "recording" && currentRecording));

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

  const handleResetDevice = () => {
    resetRecordingSession();
    clearEditedRecordingAssets();
    clearUploadedAnalysisFiles();
    setCameraError(null);
    setIsRecordingsOpen(false);
    setIsTemplatesOpen(false);
    dispatch({ type: "RESET_DEVICE" });
  };

  const closeAuthModal = () => setAuthModalMode(null);

  const handlePhoneSubmit = (phone: string) => {
    const resolution = resolvePrototypePhoneAuth({
      phone,
      knownUsers: state.knownUsers,
      connectedUserIds: new Set(
        state.deviceSession.authenticatedUsers.map((user) => user.userId)
      )
    });

    if (resolution.type === "existing-user") {
      dispatch({ type: "AUTHENTICATE_USER", payload: { user: resolution.user } });
    } else {
      dispatch({
        type: "CREATE_AND_AUTHENTICATE_USER",
        payload: { name: resolution.name }
      });
    }

    closeAuthModal();
  };

  const deleteRecording = async (recordingId: string) => {
    deleteRecordingAsset(recordingId);
    deleteEditedRecordingAsset(recordingId);

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

  const queueTemplateRender = (
    recordingId: string,
    templateId: VideoTemplateId,
    isRetry = false,
    weightKg?: string
  ) => {
    if (isRetry) {
      retryTemplateRender(recordingLibraryItems, recordingId, templateId, { weightKg });
      return;
    }

    startTemplateRender(recordingLibraryItems, recordingId, templateId, { weightKg });
  };

  const requestTemplateRender = (
    recordingId: string,
    templateId: VideoTemplateId,
    isRetry = false
  ) => {
    if (templateNeedsWeightInput(templateId)) {
      setPendingTemplateRender({ recordingId, templateId, isRetry });
      return;
    }

    queueTemplateRender(recordingId, templateId, isRetry);
  };

  const handleSubmitTemplateWeight = (weightValue: string) => {
    const normalizedWeightKg = normalizeWeightKg(weightValue);
    if (!pendingTemplateRender || !normalizedWeightKg) {
      return;
    }

    const nextRender = pendingTemplateRender;
    setPendingTemplateRender(null);
    window.setTimeout(() => {
      queueTemplateRender(
        nextRender.recordingId,
        nextRender.templateId,
        nextRender.isRetry,
        normalizedWeightKg
      );
    }, 0);
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
        className="setup-toggle"
        onClick={() => navigateTo(route === "setup" ? "kiosk" : "setup")}
        type="button"
      >
        {route === "setup" ? "Kiosk" : "Setup"}
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
          <AnalysisWorkspacePage
            recordings={recordingLibraryItems}
            uploadedFiles={uploadedAnalysisFiles}
            onUploadFiles={uploadAnalysisFiles}
            onDeleteRecording={(recordingId) => void deleteRecording(recordingId)}
            onDeleteUploadedFile={deleteUploadedAnalysisFile}
            onRefreshRecordings={() => refreshRecordingsFromServer(true)}
          />
        ) : route === "setup" ? (
          <SetupPage />
        ) : (
          <KioskPage
            state={state}
            activeUser={activeUser}
            pendingTermsUser={pendingTermsUser}
            otherAuthenticatedUsers={otherAuthenticatedUsers}
            selectedExerciseId={selectedExerciseId}
            currentRecording={currentRecording}
            latestRecording={latestRecording}
            latestRecordingItem={latestRecordingLibraryItem}
            previewStream={activeCapture?.stream ?? countdownCapture?.stream ?? null}
            liveAnalysis={liveAnalysis}
            liveAnalysisState={liveAnalysisState}
            countdownSec={countdownSec}
            isBackendOnline={backendStatus === "online"}
            isTemplateProcessing={isTemplateProcessingForLatestRecording}
            templateProcessingStates={latestRecordingTemplateProcessingStates}
            queuedTemplateIds={latestRecordingQueuedTemplateIds}
            onStartTemplateRender={(templateId) => {
              if (latestRecordingLibraryItem) {
                requestTemplateRender(latestRecordingLibraryItem.id, templateId);
              }
            }}
            onSubmitPhone={handlePhoneSubmit}
            onSelectUser={(sessionUserId) =>
              dispatch({ type: "SELECT_ACTIVE_USER", payload: { sessionUserId } })
            }
            onAcceptTerms={() => dispatch({ type: "ACCEPT_TERMS" })}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            onCancelRecording={cancelRecording}
            onSelectExercise={(exerciseId) =>
              dispatch({
                type: "SELECT_EXERCISE_FOR_NEXT_SET",
                payload: { exerciseId }
              })
            }
            onAddNewUser={() => setAuthModalMode("add")}
            onEndActiveUser={() => dispatch({ type: "END_ACTIVE_USER" })}
            onOpenTemplates={() => setIsTemplatesOpen(true)}
            onSelectTemplate={(templateId) => {
              if (latestRecordingLibraryItem) {
                selectTemplateForRecording(latestRecordingLibraryItem.id, templateId);
              }
            }}
            onRetryTemplate={(templateId) => {
              if (latestRecordingLibraryItem) {
                requestTemplateRender(latestRecordingLibraryItem.id, templateId, true);
              }
            }}
            onSwitchUser={(sessionUserId) =>
              dispatch({ type: "SELECT_ACTIVE_USER", payload: { sessionUserId } })
            }
          />
        )}
      </main>

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
        processingStates={latestRecordingTemplateProcessingStates}
        queuedTemplateIds={latestRecordingQueuedTemplateIds}
        onStartRender={(templateId) => {
          if (latestRecordingLibraryItem) {
            requestTemplateRender(latestRecordingLibraryItem.id, templateId);
          }
        }}
        onSelectTemplate={(templateId) => {
          if (latestRecordingLibraryItem) {
            selectTemplateForRecording(latestRecordingLibraryItem.id, templateId);
          }
        }}
        onRetryTemplate={(templateId) => {
          if (latestRecordingLibraryItem) {
            requestTemplateRender(latestRecordingLibraryItem.id, templateId, true);
          }
        }}
        onClose={() => setIsTemplatesOpen(false)}
      />

      <TemplateWeightModal
        open={!!pendingTemplateRender}
        templateName={pendingTemplateDefinition?.name ?? "Primary"}
        onClose={() => setPendingTemplateRender(null)}
        onSubmitWeight={handleSubmitTemplateWeight}
      />

      <DebugPanel
        open={isDebugOpen}
        state={state}
        onClose={() => setIsDebugOpen(false)}
        onResetDevice={handleResetDevice}
      />
    </div>
  );
}
