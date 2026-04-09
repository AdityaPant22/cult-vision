import {
  AnalysisMetrics,
  CalibrationState,
  LiveGuidanceCheck,
  LiveOverlayLine,
  LiveOverlaySegment,
  PoseLandmark2D,
  RecordingAnalysisResult,
  RecordingRepEvent,
  SquatMetricsSnapshot,
  SupportedExerciseId
} from "../types";

export interface BackendRepEventPayload {
  rep_index: number;
  timestamp_ms: number;
  quality_score: number;
  notes: string;
}

export const BACKEND_OFFLINE_MESSAGE =
  "Analysis backend is offline. Start the app with `npm start`, or run `npm run api:dev` in another terminal.";

export interface BackendAnalysisResultPayload {
  exercise: string;
  confidence: number;
  rep_count: number;
  overall_score: number;
  metrics: {
    range_of_motion: number;
    stability: number;
    tempo: number;
    setup: number;
  };
  feedback: string[];
  cues: string[];
  rep_events: BackendRepEventPayload[];
}

export interface BackendRecordingItem {
  id: string;
  user_name: string;
  device_name: string;
  zone_name: string;
  started_at: string;
  stopped_at: string | null;
  duration_sec: number;
  status: string;
  asset_url: string | null;
  mime_type: string | null;
  latest_result: BackendAnalysisResultPayload | null;
}

export interface CreateRecordingSessionResponse {
  recording_id: string;
  upload_url: string;
  live_analysis_ws_url: string;
  live_analysis_token: string;
  started_at: string;
}

export interface LiveAnalysisUpdate {
  type: string;
  exercise: string;
  selected_exercise: SupportedExerciseId | null;
  confidence: number;
  rep_count: number;
  form_status: string;
  cues: string[];
  feedback_items: string[];
  checks: LiveGuidanceCheck[];
  primary_cues: string[];
  guidance_confidence: number;
  calibration_state: CalibrationState;
  rep_phase: string;
  metrics: {
    range_of_motion: number;
    stability: number;
    tempo: number;
    setup: number;
  };
  pose_landmarks: PoseLandmark2D[];
  overlay_segments: Array<{
    id: string;
    from_landmark: LiveOverlaySegment["fromLandmark"];
    to_landmark: LiveOverlaySegment["toLandmark"];
    label: string;
    status: LiveOverlaySegment["status"];
  }>;
  overlay_lines: LiveOverlayLine[];
  squat_metrics: SquatMetricsSnapshot;
}

export interface AnalysisJobResponse {
  job_id: string;
  status: string;
  progress: number;
  message: string;
  source_label: string;
  result: BackendAnalysisResultPayload | null;
}

function buildAbsoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}

function normalizeApiError(status: number, text: string): string {
  const trimmed = text.trim();

  if (
    trimmed === "" ||
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.includes("Error occurred while trying to proxy") ||
    trimmed.includes("connect ECONNREFUSED") ||
    trimmed.includes("socket hang up")
  ) {
    return BACKEND_OFFLINE_MESSAGE;
  }

  const withoutHtml = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return withoutHtml || `Request failed: ${status}`;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new Error(BACKEND_OFFLINE_MESSAGE);
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(normalizeApiError(response.status, message));
  }

  return (await response.json()) as T;
}

export async function checkBackendHealth(): Promise<void> {
  await apiRequest<{ status: string }>("/api/health");
}

export function mapAnalysisMetrics(
  metrics: BackendAnalysisResultPayload["metrics"]
): AnalysisMetrics {
  return {
    rangeOfMotion: metrics.range_of_motion,
    stability: metrics.stability,
    tempo: metrics.tempo,
    setup: metrics.setup
  };
}

export function mapRepEvents(repEvents: BackendRepEventPayload[]): RecordingRepEvent[] {
  return repEvents.map((event) => ({
    repIndex: event.rep_index,
    timestampMs: event.timestamp_ms,
    qualityScore: event.quality_score,
    notes: event.notes
  }));
}

export function mapAnalysisResult(
  result: BackendAnalysisResultPayload | null
): RecordingAnalysisResult | null {
  if (!result) {
    return null;
  }

  return {
    exercise: result.exercise,
    confidence: result.confidence,
    repCount: result.rep_count,
    overallScore: result.overall_score,
    metrics: mapAnalysisMetrics(result.metrics),
    feedback: result.feedback,
    cues: result.cues,
    repEvents: mapRepEvents(result.rep_events)
  };
}

export function toWebSocketUrl(path: string): string {
  const url = new URL(buildAbsoluteUrl(path));
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function createRecordingSession(payload: {
  deviceId: string;
  deviceName: string;
  zoneName: string;
  userId: string;
  userName: string;
  selectedExercise: SupportedExerciseId;
  startedAt?: string;
}): Promise<CreateRecordingSessionResponse> {
  return apiRequest<CreateRecordingSessionResponse>("/api/recordings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      device_id: payload.deviceId,
      device_name: payload.deviceName,
      zone_name: payload.zoneName,
      user_id: payload.userId,
      user_name: payload.userName,
      selected_exercise: payload.selectedExercise,
      started_at: payload.startedAt
    })
  });
}

export async function uploadRecordingBlob(
  recordingId: string,
  blob: Blob,
  filename: string
): Promise<void> {
  const formData = new FormData();
  formData.append("file", blob, filename);

  await apiRequest(`/api/recordings/${recordingId}/upload`, {
    method: "POST",
    body: formData
  });
}

export async function markRecordingUploadComplete(payload: {
  recordingId: string;
  stoppedAt: string;
  durationSec: number;
}): Promise<void> {
  await apiRequest(`/api/recordings/${payload.recordingId}/upload-complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      stopped_at: payload.stoppedAt,
      duration_sec: payload.durationSec
    })
  });
}

export async function listBackendRecordings(): Promise<BackendRecordingItem[]> {
  return apiRequest<BackendRecordingItem[]>("/api/recordings");
}

export async function deleteBackendRecording(recordingId: string): Promise<void> {
  await apiRequest(`/api/recordings/${recordingId}`, {
    method: "DELETE"
  });
}

export async function createAnalysisJobs(payload: {
  recordingIds: string[];
  files: File[];
}): Promise<{ jobs: AnalysisJobResponse[] }> {
  const formData = new FormData();

  payload.recordingIds.forEach((recordingId) => {
    formData.append("recording_ids", recordingId);
  });

  payload.files.forEach((file) => {
    formData.append("files", file, file.name);
  });

  return apiRequest<{ jobs: AnalysisJobResponse[] }>("/api/analysis/jobs", {
    method: "POST",
    body: formData
  });
}

export async function getAnalysisJob(jobId: string): Promise<AnalysisJobResponse> {
  return apiRequest<AnalysisJobResponse>(`/api/analysis/jobs/${jobId}`);
}

export async function listAnalysisJobs(): Promise<AnalysisJobResponse[]> {
  const response = await apiRequest<{ jobs: AnalysisJobResponse[] }>("/api/analysis/jobs");
  return response.jobs;
}

export function absoluteAssetUrl(path: string | null): string | null {
  if (!path) {
    return null;
  }

  return buildAbsoluteUrl(path);
}
