import { useEffect, useMemo, useRef } from "react";
import { LiveAnalysisUpdate } from "../api/analysisApi";
import { FULL_POSE_CONNECTIONS } from "../features/live-analysis/model/overlay";
import {
  formatCalibrationState,
  formatLiveConnectionState
} from "../features/live-analysis/model/presentation";
import { formatPhaseLabel, formatTimer } from "../shared/lib/format";
import { AuthenticatedUserSession, Recording, SupportedExerciseId } from "../types";

interface RecordingScreenProps {
  activeUser: AuthenticatedUserSession;
  recording: Recording | null;
  selectedExerciseId: SupportedExerciseId | null;
  previewStream: MediaStream | null;
  liveAnalysis: LiveAnalysisUpdate | null;
  liveAnalysisState: "idle" | "connecting" | "live" | "offline";
  countdownSec: number | null;
  onStopRecording: () => void;
  onCancelRecording: () => void;
}

export function RecordingScreen({
  activeUser,
  recording,
  selectedExerciseId,
  previewStream,
  liveAnalysis,
  liveAnalysisState,
  countdownSec,
  onStopRecording,
  onCancelRecording
}: RecordingScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isCountingDown = countdownSec !== null;
  const exerciseLabel =
    selectedExerciseId ??
    recording?.exerciseId ??
    liveAnalysis?.selected_exercise ??
    (liveAnalysis?.exercise as SupportedExerciseId | undefined) ??
    null;

  const landmarkMap = useMemo(
    () =>
      new Map(
        (liveAnalysis?.pose_landmarks ?? []).map((landmark) => [landmark.name, landmark] as const)
      ),
    [liveAnalysis?.pose_landmarks]
  );

  const primaryCues = useMemo(() => {
    if (isCountingDown) {
      if ((liveAnalysis?.primary_cues?.length ?? 0) > 0) {
        return liveAnalysis?.primary_cues ?? [];
      }

      return ["Calibrating framing for live coaching..."];
    }

    if (liveAnalysisState === "offline") {
      return ["Live guidance is offline right now. Recording is still running."];
    }

    if ((liveAnalysis?.primary_cues?.length ?? 0) > 0) {
      return liveAnalysis?.primary_cues ?? [];
    }

    if ((liveAnalysis?.feedback_items?.length ?? 0) > 0) {
      return liveAnalysis?.feedback_items ?? [];
    }

    return ["Move fully into frame so the pose overlay can lock onto the set."];
  }, [
    isCountingDown,
    liveAnalysis?.feedback_items,
    liveAnalysis?.primary_cues,
    liveAnalysisState
  ]);

  const visibleChecks = useMemo(
    () => (liveAnalysis?.checks ?? []).filter((check) => check.status === "warn").slice(0, 2),
    [liveAnalysis?.checks]
  );

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = previewStream;

    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [previewStream]);

  return (
    <section className="screen recording-screen">
      <div className="recording-main-grid">
        <div className="camera-preview camera-preview-large recording-video-panel">
          <div className="camera-overlay">
            {isCountingDown ? (
              <span className="timer-pill">Get Ready</span>
            ) : (
              <span className="rec-indicator">REC</span>
            )}
            <span className="timer-pill">
              {isCountingDown
                ? countdownSec === 0
                  ? "Starting..."
                  : `Starts in ${countdownSec}s`
                : formatTimer(recording?.durationSec ?? 0)}
            </span>
          </div>

          <div className="preview-column">
            <div className="recording-header-compact">
              <p className="eyebrow">{isCountingDown ? "Starting Soon" : "Guided Recording"}</p>
              <h1>{exerciseLabel ?? activeUser.userName}</h1>
              <p className="subtle-copy compact-copy">
                {isCountingDown
                  ? `The set is locked to ${exerciseLabel ?? "the selected exercise"} for ${activeUser.userName}.`
                  : `Recording ${exerciseLabel ?? "exercise"} guidance for ${recording?.userName ?? activeUser.userName}.`}
              </p>
            </div>

            <div className="preview-frame preview-frame-large recording-preview-shell">
              {previewStream ? (
                <>
                  <video
                    ref={videoRef}
                    className="camera-video"
                    autoPlay
                    muted
                    playsInline
                  />
                  {!isCountingDown && (liveAnalysis?.pose_landmarks.length ?? 0) > 0 ? (
                    <svg
                      className="pose-overlay"
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {FULL_POSE_CONNECTIONS.map(([fromLandmark, toLandmark]) => {
                        const start = landmarkMap.get(fromLandmark);
                        const end = landmarkMap.get(toLandmark);

                        if (!start || !end || start.visibility < 0.2 || end.visibility < 0.2) {
                          return null;
                        }

                        return (
                          <line
                            key={`${fromLandmark}-${toLandmark}`}
                            className="pose-line pose-line-muted"
                            x1={start.x * 100}
                            y1={start.y * 100}
                            x2={end.x * 100}
                            y2={end.y * 100}
                          />
                        );
                      })}

                      {(liveAnalysis?.overlay_segments ?? []).map((segment) => {
                        const start = landmarkMap.get(segment.from_landmark);
                        const end = landmarkMap.get(segment.to_landmark);

                        if (!start || !end || start.visibility < 0.2 || end.visibility < 0.2) {
                          return null;
                        }

                        return (
                          <line
                            key={segment.id}
                            className={`pose-line ${
                              segment.status === "ok" ? "pose-line-ok" : "pose-line-warn"
                            }`}
                            x1={start.x * 100}
                            y1={start.y * 100}
                            x2={end.x * 100}
                            y2={end.y * 100}
                          />
                        );
                      })}
                    </svg>
                  ) : null}

                  {isCountingDown ? (
                    <div className="countdown-overlay">
                      <div className="countdown-ring">
                        <strong>{countdownSec === 0 ? "GO" : countdownSec}</strong>
                        <span>Recording starts soon</span>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <span>Starting camera...</span>
              )}
            </div>
          </div>
        </div>

        <aside className="recording-side-panel">
          <div className="live-analysis-card live-analysis-card-wide">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Live Guidance</p>
                <h2>{exerciseLabel ?? "Waiting for exercise"}</h2>
              </div>
              <span className={`status-pill ${isCountingDown ? "connecting" : liveAnalysisState}`}>
                {isCountingDown
                  ? formatCalibrationState(liveAnalysis?.calibration_state)
                  : formatLiveConnectionState(liveAnalysisState)}
              </span>
            </div>

            <div className="summary-grid summary-grid-tight">
              <div className="summary-card">
                <span className="label">Reps</span>
                <strong>{isCountingDown ? "--" : liveAnalysis?.rep_count ?? 0}</strong>
              </div>
              <div className="summary-card">
                <span className="label">Phase</span>
                <strong>{isCountingDown ? "--" : formatPhaseLabel(liveAnalysis?.rep_phase)}</strong>
              </div>
              <div className="summary-card">
                <span className="label">{isCountingDown ? "Readiness" : "Guidance"}</span>
                <strong>
                  {isCountingDown
                    ? formatCalibrationState(liveAnalysis?.calibration_state)
                    : `${Math.round((liveAnalysis?.guidance_confidence ?? 0) * 100)}%`}
                </strong>
              </div>
              <div className="summary-card">
                <span className="label">Form</span>
                <strong>{isCountingDown ? "--" : liveAnalysis?.form_status ?? "--"}</strong>
              </div>
            </div>

            <div className="analysis-feedback-list compact-feedback-list">
              {primaryCues.map((item) => (
                <div key={item} className="history-item">
                  <span>{item}</span>
                </div>
              ))}

              {!isCountingDown && visibleChecks.length > 0 ? (
                <div className="guidance-check-list">
                  {visibleChecks.map((check) => (
                    <div key={check.id} className="guidance-check-item">
                      <span>{check.label}</span>
                      <strong>{Math.round(check.confidence * 100)}%</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="recording-controls-card">
            <div className="history-item">
              <span>Recording as</span>
              <strong>{activeUser.userName}</strong>
            </div>
            <div className="history-item">
              <span>Selected exercise</span>
              <strong>{exerciseLabel ?? "Not set"}</strong>
            </div>
            <div className="history-item">
              <span>Ownership</span>
              <strong>Locked</strong>
            </div>

            <div className="recording-actions-stack">
              {isCountingDown ? (
                <button className="ghost-button tall-button" type="button" onClick={onCancelRecording}>
                  Cancel Start
                </button>
              ) : (
                <>
                  <button
                    className="danger-button tall-button"
                    type="button"
                    onClick={onStopRecording}
                  >
                    Stop Recording
                  </button>
                  <button
                    className="ghost-button tall-button"
                    type="button"
                    onClick={onCancelRecording}
                  >
                    Cancel Recording
                  </button>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
