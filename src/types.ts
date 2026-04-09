export type KioskView =
  | "idle"
  | "terms"
  | "selectUser"
  | "ready"
  | "recording"
  | "postRecording";

export type SupportedExerciseId =
  | "Squat"
  | "Push-up"
  | "Lunge"
  | "Bicep Curl";

export interface User {
  id: string;
  name: string;
  avatarColor: string;
  avatarInitial: string;
}

export interface AuthenticatedUserSession {
  sessionUserId: string;
  userId: string;
  userName: string;
  joinedAt: string;
  isActive: boolean;
}

export type RecordingStatus =
  | "recording"
  | "uploading"
  | "uploaded"
  | "processing"
  | "ready"
  | "completed"
  | "failed"
  | "cancelled";

export interface Recording {
  id: string;
  userId: string;
  userName: string;
  sessionUserId: string;
  exerciseId: SupportedExerciseId | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number;
  status: RecordingStatus;
  liveRepEvents?: RecordingRepEvent[];
}

export interface AnalysisMetrics {
  rangeOfMotion: number;
  stability: number;
  tempo: number;
  setup: number;
}

export interface RecordingRepEvent {
  repIndex: number;
  timestampMs: number;
  qualityScore: number;
  notes: string;
}

export interface RecordingAnalysisResult {
  exercise: string;
  confidence: number;
  repCount: number;
  overallScore: number;
  metrics: AnalysisMetrics;
  feedback: string[];
  cues: string[];
  repEvents: RecordingRepEvent[];
}

export interface PoseLandmark2D {
  name: string;
  x: number;
  y: number;
  visibility: number;
}

export type GuidanceCheckStatus = "ok" | "warn";

export type CalibrationState = "warming_up" | "ready" | "weak";

export interface LiveGuidanceCheck {
  id: string;
  label: string;
  status: GuidanceCheckStatus;
  severity: number;
  confidence: number;
  phase: string;
  message: string;
}

export type OverlaySegmentStatus = "ok" | "warn";

export interface LiveOverlaySegment {
  id: string;
  fromLandmark: string;
  toLandmark: string;
  label: string;
  status: OverlaySegmentStatus;
}

export type VideoTemplateId =
  | "primary"
  | "cult-eidos"
  | "gym-highlight"
  | "rep-bingo"
  | "depth-drive"
  | "iron-echo"
  | "arena-lift";

export interface EditedRecordingVersion {
  templateId: VideoTemplateId;
  templateName: string;
  playbackUrl: string;
  mimeType: string;
  createdAt: string;
}

export interface RecordingLibraryItem {
  id: string;
  userName: string;
  deviceName: string;
  zoneName: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSec: number;
  status: string;
  playbackUrl: string | null;
  mimeType: string | null;
  editedVersion: EditedRecordingVersion | null;
  editedVersions: EditedRecordingVersion[];
  selectedEditedTemplateId: VideoTemplateId | null;
  analysisResult: RecordingAnalysisResult | null;
  templateRepEvents: RecordingRepEvent[];
  templateRepCount: number;
  templateTimingSource: "none" | "live" | "estimated" | "final";
}

export interface DeviceSession {
  deviceId: string;
  deviceName: string;
  zoneName: string;
  authenticatedUsers: AuthenticatedUserSession[];
  activeUserId: string | null;
  recordings: Recording[];
}

export interface InactivityConfig {
  enabled: boolean;
  idleTimeoutSec: number;
  warningCountdownSec: number;
  warningStartedAt: string | null;
}

export interface KioskState {
  knownUsers: User[];
  deviceSession: DeviceSession;
  view: KioskView;
  selectedExerciseId: SupportedExerciseId | null;
  currentRecordingId: string | null;
  lastCompletedRecordingId: string | null;
  pendingTermsSessionUserId: string | null;
  inactivity: InactivityConfig;
}

export type AppState = KioskState;
