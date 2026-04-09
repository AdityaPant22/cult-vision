import { IdleScreen } from "../components/IdleScreen";
import { PostRecordingScreen } from "../components/PostRecordingScreen";
import { ReadyScreen } from "../components/ReadyScreen";
import { RecordingScreen } from "../components/RecordingScreen";
import { SelectUserScreen } from "../components/SelectUserScreen";
import { TermsScreen } from "../components/TermsScreen";
import { LiveAnalysisUpdate } from "../api/analysisApi";
import {
  AuthenticatedUserSession,
  KioskState,
  Recording,
  RecordingLibraryItem,
  SupportedExerciseId
} from "../types";

interface KioskPageProps {
  state: KioskState;
  activeUser: AuthenticatedUserSession | null;
  pendingTermsUser: AuthenticatedUserSession | null;
  otherAuthenticatedUsers: AuthenticatedUserSession[];
  selectedExerciseId: SupportedExerciseId | null;
  currentRecording: Recording | null;
  latestRecording: Recording | null;
  latestRecordingItem: RecordingLibraryItem | null;
  previewStream: MediaStream | null;
  liveAnalysis: LiveAnalysisUpdate | null;
  liveAnalysisState: "idle" | "connecting" | "live" | "offline";
  countdownSec: number | null;
  isBackendOnline: boolean;
  isTemplateProcessing: boolean;
  onSubmitPhone: (phone: string) => void;
  onSelectUser: (sessionUserId: string) => void;
  onAcceptTerms: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  onSelectExercise: (exerciseId: SupportedExerciseId) => void;
  onAddNewUser: () => void;
  onEndActiveUser: () => void;
  onOpenTemplates: () => void;
  onSwitchUser: (sessionUserId: string) => void;
}

export function KioskPage({
  state,
  activeUser,
  pendingTermsUser,
  otherAuthenticatedUsers,
  selectedExerciseId,
  currentRecording,
  latestRecording,
  latestRecordingItem,
  previewStream,
  liveAnalysis,
  liveAnalysisState,
  countdownSec,
  isBackendOnline,
  isTemplateProcessing,
  onSubmitPhone,
  onSelectUser,
  onAcceptTerms,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  onSelectExercise,
  onAddNewUser,
  onEndActiveUser,
  onOpenTemplates,
  onSwitchUser
}: KioskPageProps) {
  const shouldShowRecordingScreen =
    !!activeUser &&
    ((countdownSec !== null && previewStream) ||
      (state.view === "recording" && currentRecording));

  if (state.view === "idle") {
    return (
      <IdleScreen
        deviceName={state.deviceSession.deviceName}
        zoneName={state.deviceSession.zoneName}
        authenticatedUsers={state.deviceSession.authenticatedUsers}
        activeUser={activeUser}
        onSubmitPhone={onSubmitPhone}
      />
    );
  }

  if (state.view === "selectUser") {
    return (
      <SelectUserScreen
        authenticatedUsers={state.deviceSession.authenticatedUsers}
        onSelectUser={onSelectUser}
        onAddNewUser={onAddNewUser}
      />
    );
  }

  if (state.view === "terms" && pendingTermsUser) {
    return <TermsScreen user={pendingTermsUser} onProceed={onAcceptTerms} />;
  }

  if (state.view === "ready" && activeUser) {
    return (
      <ReadyScreen
        activeUser={activeUser}
        authenticatedUsers={state.deviceSession.authenticatedUsers}
        isBackendOnline={isBackendOnline}
        selectedExerciseId={selectedExerciseId}
        onStartRecording={onStartRecording}
        onSelectConnectedUser={onSelectUser}
        onSelectExercise={onSelectExercise}
        onAddNewUser={onAddNewUser}
        onEndActiveUser={onEndActiveUser}
      />
    );
  }

  if (shouldShowRecordingScreen && activeUser) {
    return (
      <RecordingScreen
        activeUser={activeUser}
        recording={currentRecording}
        selectedExerciseId={currentRecording?.exerciseId ?? selectedExerciseId}
        previewStream={previewStream}
        liveAnalysis={liveAnalysis}
        liveAnalysisState={liveAnalysisState}
        countdownSec={countdownSec}
        onStopRecording={onStopRecording}
        onCancelRecording={onCancelRecording}
      />
    );
  }

  if (state.view === "postRecording" && latestRecording) {
    return (
      <PostRecordingScreen
        activeUser={activeUser}
        latestRecording={latestRecording}
        latestRecordingItem={latestRecordingItem}
        otherUsers={otherAuthenticatedUsers}
        isBackendOnline={isBackendOnline}
        selectedExerciseId={selectedExerciseId}
        onRecordNextSet={onStartRecording}
        onEndActiveUser={onEndActiveUser}
        onAddNewUser={onAddNewUser}
        onSelectExercise={onSelectExercise}
        onOpenTemplates={onOpenTemplates}
        onSwitchUser={onSwitchUser}
        isTemplateProcessing={isTemplateProcessing}
      />
    );
  }

  return null;
}
