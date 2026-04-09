import { AppState, User } from "./types";

const colors = [
  "#f25f5c",
  "#247ba0",
  "#70c1b3",
  "#f7b267",
  "#7f95d1",
  "#b8dbd9",
  "#84a59d",
  "#f28482"
];

function createUser(name: string, index: number): User {
  return {
    id: `user-${index + 1}`,
    name,
    avatarColor: colors[index % colors.length],
    avatarInitial: name.charAt(0).toUpperCase()
  };
}

export const seededUsers: User[] = [
  "Rahul",
  "Aisha",
  "Kabir",
  "Neha",
  "Arjun",
  "Maya",
  "Dev",
  "Sara"
].map(createUser);

export const STORAGE_KEY = "cult-vision-kiosk-state-v1";

export function createInitialState(): AppState {
  return {
    knownUsers: seededUsers,
    deviceSession: {
      deviceId: "device-strength-bay-01",
      deviceName: "Bay Tablet 01",
      zoneName: "Strength Zone A",
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
      enabled: true,
      idleTimeoutSec: 60,
      warningCountdownSec: 10,
      warningStartedAt: null
    }
  };
}
