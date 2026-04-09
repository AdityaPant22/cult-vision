import { isSupportedExerciseId } from "../../../exerciseCatalog";
import {
  AppState,
  AuthenticatedUserSession,
  Recording,
  SupportedExerciseId
} from "../../../types";

export function selectActiveUser(state: AppState): AuthenticatedUserSession | null {
  return (
    state.deviceSession.authenticatedUsers.find(
      (user) => user.sessionUserId === state.deviceSession.activeUserId
    ) ?? null
  );
}

export function selectSelectedExerciseId(state: AppState): SupportedExerciseId | null {
  return isSupportedExerciseId(state.selectedExerciseId) ? state.selectedExerciseId : null;
}

export function selectCurrentRecording(state: AppState): Recording | null {
  return (
    state.deviceSession.recordings.find(
      (recording) => recording.id === state.currentRecordingId
    ) ?? null
  );
}

export function selectLatestRecording(state: AppState): Recording | null {
  return (
    state.deviceSession.recordings.find(
      (recording) => recording.id === state.lastCompletedRecordingId
    ) ?? null
  );
}

export function selectOtherAuthenticatedUsers(
  state: AppState
): AuthenticatedUserSession[] {
  return state.deviceSession.authenticatedUsers.filter(
    (user) => user.sessionUserId !== state.deviceSession.activeUserId
  );
}

export function selectPendingTermsUser(
  state: AppState
): AuthenticatedUserSession | null {
  return (
    state.deviceSession.authenticatedUsers.find(
      (user) => user.sessionUserId === state.pendingTermsSessionUserId
    ) ?? null
  );
}
