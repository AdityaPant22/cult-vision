import { RecordingLibraryItem } from "../types";
import { Modal } from "./Modal";

interface RecordingsModalProps {
  open: boolean;
  recordings: RecordingLibraryItem[];
  onDeleteRecording: (recordingId: string) => void;
  onClose: () => void;
}

function formatDuration(totalSec: number): string {
  if (totalSec < 60) {
    return `${totalSec}s`;
  }

  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

export function RecordingsModal({
  open,
  recordings,
  onDeleteRecording,
  onClose
}: RecordingsModalProps) {
  return (
    <Modal open={open} title="Recordings Library" onClose={onClose}>
      {recordings.length === 0 ? (
        <p className="modal-copy">No recordings captured yet.</p>
      ) : (
        <div className="recordings-grid">
          {recordings.map((recording) => (
            <article key={recording.id} className="recording-card">
              <div className="panel-header">
                <div>
                  <strong>{recording.userName}</strong>
                  <p className="subtle-copy">
                    {new Date(recording.startedAt).toLocaleString()} • {recording.deviceName}
                  </p>
                </div>
                <span className={`status-pill ${recording.status}`}>
                  {recording.status === "ready"
                    ? "Ready"
                    : recording.status === "processing"
                      ? "Analyzing"
                      : formatDuration(recording.durationSec)}
                </span>
              </div>

              <div className="recording-card-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => onDeleteRecording(recording.id)}
                  disabled={recording.status === "recording"}
                >
                  Delete Recording
                </button>
              </div>

              {recording.playbackUrl ? (
                <div className="recording-video-stack">
                  <div className="recording-media-block">
                    <div className="panel-header">
                      <strong>Original Capture</strong>
                    </div>
                    <video
                      className="recording-video"
                      controls
                      playsInline
                      preload="metadata"
                      src={recording.playbackUrl}
                    />
                  </div>

                  {recording.editedVersion ? (
                    <div className="recording-media-block">
                      <div className="panel-header">
                        <strong>{recording.editedVersion.templateName}</strong>
                        <a
                          className="secondary-button"
                          href={recording.editedVersion.playbackUrl}
                          download={`${recording.userName.toLowerCase().replace(/\s+/g, "-")}-${recording.editedVersion.templateId}.webm`}
                        >
                          Download Edit
                        </a>
                      </div>
                      <video
                        className="recording-video"
                        controls
                        playsInline
                        preload="metadata"
                        src={recording.editedVersion.playbackUrl}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="recording-unavailable">
                  <strong>Playback unavailable</strong>
                  <p className="subtle-copy">
                    The recording exists in saved metadata, but the media asset is not
                    currently available.
                  </p>
                </div>
              )}

              {recording.analysisResult ? (
                <div className="analysis-inline-result">
                  <div className="history-item">
                    <span>Exercise</span>
                    <strong>{recording.analysisResult.exercise}</strong>
                  </div>
                  <div className="history-item">
                    <span>Score</span>
                    <strong>{recording.analysisResult.overallScore}/100</strong>
                  </div>
                  <div className="history-item">
                    <span>Reps</span>
                    <strong>{recording.analysisResult.repCount}</strong>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}
