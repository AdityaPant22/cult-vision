import { createInitialState } from "../mockData";
import {
  AppState,
  AuthenticatedUserSession,
  Recording,
  RecordingRepEvent,
  SupportedExerciseId,
  User
} from "../types";

type Action =
  | { type: "AUTHENTICATE_USER"; payload: { user: User; phone: string } }
  | { type: "CREATE_AND_AUTHENTICATE_USER"; payload: { name: string; phone: string } }
  | { type: "ACCEPT_TERMS" }
  | { type: "SELECT_ACTIVE_USER"; payload: { sessionUserId: string } }
  | {
      type: "SELECT_EXERCISE_FOR_NEXT_SET";
      payload: { exerciseId: SupportedExerciseId };
    }
  | {
      type: "START_RECORDING";
      payload: {
        recordingId: string;
        startedAt: string;
        exerciseId: SupportedExerciseId;
      };
    }
  | {
      type: "SYNC_RECORDING_LIVE_REP_EVENTS";
      payload: { recordingId: string; repEvents: RecordingRepEvent[] };
    }
  | { type: "TICK_RECORDING"; payload: { now: string } }
  | { type: "STOP_RECORDING"; payload: { stoppedAt: string } }
  | { type: "CANCEL_RECORDING"; payload: { stoppedAt: string } }
  | { type: "MARK_RECORDING_UPLOADED"; payload: { recordingId: string } }
  | { type: "DELETE_RECORDING"; payload: { recordingId: string } }
  | { type: "END_ACTIVE_USER" }
  | { type: "RESET_DEVICE" }
  | { type: "SET_TIMEOUT_ENABLED"; payload: { enabled: boolean } }
  | { type: "SHOW_INACTIVITY_WARNING"; payload: { startedAt: string } }
  | { type: "HIDE_INACTIVITY_WARNING" };

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function setActiveUser(
  users: AuthenticatedUserSession[],
  activeUserId: string | null
): AuthenticatedUserSession[] {
  return users.map((user) => ({
    ...user,
    isActive: user.sessionUserId === activeUserId
  }));
}

function ensureView(state: AppState): AppState {
  if (state.deviceSession.authenticatedUsers.length === 0) {
    return {
      ...state,
      view: "idle",
      deviceSession: {
        ...state.deviceSession,
        activeUserId: null
      },
      lastCompletedRecordingId: null
    };
  }

  if (state.pendingTermsSessionUserId) {
    return {
      ...state,
      view: "terms"
    };
  }

  if (state.currentRecordingId) {
    return {
      ...state,
      view: "recording"
    };
  }

  if (state.deviceSession.activeUserId) {
    return {
      ...state,
      view: "ready"
    };
  }

  return {
    ...state,
    view: "selectUser"
  };
}

function getActiveSession(state: AppState): AuthenticatedUserSession | null {
  const { activeUserId, authenticatedUsers } = state.deviceSession;

  return authenticatedUsers.find((user) => user.sessionUserId === activeUserId) ?? null;
}

function updateCurrentRecording(
  recordings: Recording[],
  currentRecordingId: string,
  now: string
): Recording[] {
  return recordings.map((recording) => {
    if (recording.id !== currentRecordingId || recording.status !== "recording") {
      return recording;
    }

    const durationSec = Math.max(
      0,
      Math.floor(
        (new Date(now).getTime() - new Date(recording.startedAt).getTime()) / 1000
      )
    );

    return {
      ...recording,
      durationSec
    };
  });
}

function completeRecording(
  recording: Recording,
  stoppedAt: string,
  status: Recording["status"]
): Recording {
  return {
    ...recording,
    stoppedAt,
    durationSec: Math.max(
      1,
      Math.floor(
        (new Date(stoppedAt).getTime() - new Date(recording.startedAt).getTime()) / 1000
      )
    ),
    status
  };
}

function createRecordingForSession(
  session: AuthenticatedUserSession,
  recordingId: string,
  startedAt: string,
  exerciseId: SupportedExerciseId
): Recording {
  return {
    id: recordingId,
    userId: session.userId,
    userName: session.userName,
    sessionUserId: session.sessionUserId,
    exerciseId,
    startedAt,
    stoppedAt: null,
    durationSec: 0,
    status: "recording",
    liveRepEvents: []
  };
}

export function kioskReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "AUTHENTICATE_USER": {
      const existingSession = state.deviceSession.authenticatedUsers.find(
        (session) => session.userId === action.payload.user.id
      );

      const nextSessionUserId = existingSession?.sessionUserId ?? createId("session");

      const authenticatedUsers = existingSession
        ? state.deviceSession.authenticatedUsers
        : [
            ...state.deviceSession.authenticatedUsers,
            {
              sessionUserId: nextSessionUserId,
              userId: action.payload.user.id,
              userName: action.payload.user.name,
              phoneNumber: action.payload.phone,
              joinedAt: new Date().toISOString(),
              isActive: false
            }
          ];

      return ensureView({
        ...state,
        deviceSession: {
          ...state.deviceSession,
          authenticatedUsers: setActiveUser(
            authenticatedUsers,
            state.deviceSession.activeUserId ?? nextSessionUserId
          ),
          activeUserId: state.deviceSession.activeUserId ?? nextSessionUserId
        },
        pendingTermsSessionUserId: existingSession ? null : nextSessionUserId,
        inactivity: {
          ...state.inactivity,
          warningStartedAt: null
        }
      });
    }
    case "CREATE_AND_AUTHENTICATE_USER": {
      const name = action.payload.name.trim();
      if (!name) {
        return state;
      }

      const newUser: User = {
        id: createId("user"),
        name,
        avatarInitial: name.charAt(0).toUpperCase(),
        avatarColor: "#9bc53d"
      };

      const authenticatedUsers = [
        ...state.deviceSession.authenticatedUsers,
        {
          sessionUserId: createId("session"),
          userId: newUser.id,
          userName: newUser.name,
          phoneNumber: action.payload.phone,
          joinedAt: new Date().toISOString(),
          isActive: false
        }
      ];
      const newSessionId = authenticatedUsers[authenticatedUsers.length - 1]?.sessionUserId ?? null;

      return ensureView({
        ...state,
        knownUsers: [newUser, ...state.knownUsers],
        deviceSession: {
          ...state.deviceSession,
          authenticatedUsers: setActiveUser(
            authenticatedUsers,
            state.deviceSession.activeUserId ?? newSessionId
          ),
          activeUserId: state.deviceSession.activeUserId ?? newSessionId
        },
        pendingTermsSessionUserId: newSessionId,
        inactivity: {
          ...state.inactivity,
          warningStartedAt: null
        }
      });
    }
    case "ACCEPT_TERMS": {
      return ensureView({
        ...state,
        pendingTermsSessionUserId: null,
        inactivity: {
          ...state.inactivity,
          warningStartedAt: null
        }
      });
    }
    case "SELECT_ACTIVE_USER": {
      if (state.view === "recording") {
        return state;
      }

      const hasSession = state.deviceSession.authenticatedUsers.some(
        (user) => user.sessionUserId === action.payload.sessionUserId
      );

      if (!hasSession) {
        return state;
      }

      return {
        ...state,
        view: "ready",
        deviceSession: {
          ...state.deviceSession,
          activeUserId: action.payload.sessionUserId,
          authenticatedUsers: setActiveUser(
            state.deviceSession.authenticatedUsers,
            action.payload.sessionUserId
          )
        },
        selectedExerciseId: null,
        pendingTermsSessionUserId: null,
        inactivity: {
          ...state.inactivity,
          warningStartedAt: null
        }
      };
    }
    case "SELECT_EXERCISE_FOR_NEXT_SET": {
      return {
        ...state,
        selectedExerciseId: action.payload.exerciseId,
        inactivity: {
          ...state.inactivity,
          warningStartedAt: null
        }
      };
    }
    case "START_RECORDING": {
      const activeSession = getActiveSession(state);
      if (!activeSession || state.view === "recording") {
        return state;
      }
      const newRecording = createRecordingForSession(
        activeSession,
        action.payload.recordingId,
        action.payload.startedAt,
        action.payload.exerciseId
      );

      return {
        ...state,
        view: "recording",
        deviceSession: {
          ...state.deviceSession,
          activeUserId: activeSession.sessionUserId,
          authenticatedUsers: setActiveUser(
            state.deviceSession.authenticatedUsers,
            activeSession.sessionUserId
          ),
          recordings: [...state.deviceSession.recordings, newRecording]
        },
        currentRecordingId: newRecording.id,
        lastCompletedRecordingId: null,
        pendingTermsSessionUserId: null,
        inactivity: {
          ...state.inactivity,
          warningStartedAt: null
        }
      };
    }
    case "SYNC_RECORDING_LIVE_REP_EVENTS": {
      return {
        ...state,
        deviceSession: {
          ...state.deviceSession,
          recordings: state.deviceSession.recordings.map((recording) =>
            recording.id === action.payload.recordingId
              ? {
                  ...recording,
                  liveRepEvents: action.payload.repEvents
                }
              : recording
          )
        }
      };
    }
    case "TICK_RECORDING": {
      if (!state.currentRecordingId) {
        return state;
      }

      return {
        ...state,
        deviceSession: {
          ...state.deviceSession,
          recordings: updateCurrentRecording(
            state.deviceSession.recordings,
            state.currentRecordingId,
            action.payload.now
          )
        }
      };
    }
    case "STOP_RECORDING": {
      if (!state.currentRecordingId) {
        return state;
      }

      return {
        ...state,
        view: "postRecording",
        selectedExerciseId: null,
        currentRecordingId: null,
        lastCompletedRecordingId: state.currentRecordingId,
        pendingTermsSessionUserId: null,
        deviceSession: {
          ...state.deviceSession,
          recordings: state.deviceSession.recordings.map((recording) =>
            recording.id === state.currentRecordingId
              ? completeRecording(recording, action.payload.stoppedAt, "uploading")
              : recording
          )
        }
      };
    }
    case "CANCEL_RECORDING": {
      if (!state.currentRecordingId) {
        return state;
      }

      const nextView =
        state.deviceSession.activeUserId ? "ready" : "selectUser";

      return {
        ...state,
        view: nextView,
        currentRecordingId: null,
        lastCompletedRecordingId: null,
        pendingTermsSessionUserId: null,
        deviceSession: {
          ...state.deviceSession,
          recordings: state.deviceSession.recordings.map((recording) =>
            recording.id === state.currentRecordingId
              ? completeRecording(recording, action.payload.stoppedAt, "cancelled")
              : recording
          )
        }
      };
    }
    case "MARK_RECORDING_UPLOADED": {
      return {
        ...state,
        deviceSession: {
          ...state.deviceSession,
          recordings: state.deviceSession.recordings.map((recording) =>
            recording.id === action.payload.recordingId && recording.status === "uploading"
              ? {
                  ...recording,
                  status: "uploaded"
                }
              : recording
          )
        }
      };
    }
    case "DELETE_RECORDING": {
      if (state.currentRecordingId === action.payload.recordingId) {
        return state;
      }

      return {
        ...state,
        lastCompletedRecordingId:
          state.lastCompletedRecordingId === action.payload.recordingId
            ? null
            : state.lastCompletedRecordingId,
        deviceSession: {
          ...state.deviceSession,
          recordings: state.deviceSession.recordings.filter(
            (recording) => recording.id !== action.payload.recordingId
          )
        }
      };
    }
    case "END_ACTIVE_USER": {
      const { activeUserId, authenticatedUsers } = state.deviceSession;
      if (!activeUserId) {
        return ensureView(state);
      }

      const remainingUsers = authenticatedUsers.filter(
        (user) => user.sessionUserId !== activeUserId
      );

      return ensureView({
        ...state,
        currentRecordingId: null,
        lastCompletedRecordingId: null,
        selectedExerciseId: null,
        pendingTermsSessionUserId: null,
        deviceSession: {
          ...state.deviceSession,
          activeUserId: null,
          authenticatedUsers: setActiveUser(remainingUsers, null)
        },
        inactivity: {
          ...state.inactivity,
          warningStartedAt: null
        }
      });
    }
    case "RESET_DEVICE": {
      const initialState = createInitialState();

      return {
        ...state,
        deviceSession: {
          ...state.deviceSession,
          authenticatedUsers: [],
          activeUserId: null,
          recordings: []
        },
        view: "idle",
        selectedExerciseId: null,
        currentRecordingId: null,
        lastCompletedRecordingId: null,
        pendingTermsSessionUserId: null,
        inactivity: {
          ...state.inactivity,
          enabled: state.inactivity.enabled,
          idleTimeoutSec: initialState.inactivity.idleTimeoutSec,
          warningCountdownSec: initialState.inactivity.warningCountdownSec,
          warningStartedAt: null
        }
      };
    }
    case "SET_TIMEOUT_ENABLED": {
      return {
        ...state,
        inactivity: {
          ...state.inactivity,
          enabled: action.payload.enabled,
          warningStartedAt: null
        }
      };
    }
    case "SHOW_INACTIVITY_WARNING": {
      if (!state.inactivity.enabled || state.view === "recording") {
        return state;
      }

      return {
        ...state,
        inactivity: {
          ...state.inactivity,
          warningStartedAt: action.payload.startedAt
        }
      };
    }
    case "HIDE_INACTIVITY_WARNING": {
      return {
        ...state,
        inactivity: {
          ...state.inactivity,
          warningStartedAt: null
        }
      };
    }
    default:
      return state;
  }
}

export type { Action as KioskAction };
