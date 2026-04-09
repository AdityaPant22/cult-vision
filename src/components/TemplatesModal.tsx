import { getVideoTemplates } from "../editing/videoTemplates";
import { EditedRecordingVersion, RecordingLibraryItem, VideoTemplateId } from "../types";
import { Modal } from "./Modal";

interface TemplateProcessingState {
  recordingId: string;
  templateId: VideoTemplateId;
  progress: number;
  message: string;
  error: string | null;
}

interface TemplatesModalProps {
  open: boolean;
  recording: RecordingLibraryItem | null;
  editedVersion: EditedRecordingVersion | null;
  processingState: TemplateProcessingState | null;
  onApplyTemplate: (templateId: VideoTemplateId) => void;
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

export function TemplatesModal({
  open,
  recording,
  editedVersion,
  processingState,
  onApplyTemplate,
  onClose
}: TemplatesModalProps) {
  const templates = getVideoTemplates();
  const isProcessing =
    processingState !== null &&
    processingState.recordingId === recording?.id &&
    !processingState.error;
  const hasRepTiming = (recording?.templateRepCount ?? 0) > 0;

  return (
    <Modal open={open} title="Video Templates" onClose={onClose}>
      {!recording ? (
        <p className="modal-copy">Select a completed recording first.</p>
      ) : (
        <>
          <div className="template-recording-summary">
            <div>
              <p className="eyebrow">Latest Set</p>
              <h3>{recording.userName}</h3>
              <p className="subtle-copy">
                {formatDuration(recording.durationSec)} • {new Date(recording.startedAt).toLocaleString()}
              </p>
            </div>
            <span className={`status-pill ${recording.status}`}>{recording.status}</span>
          </div>

          {recording.playbackUrl ? (
            <video
              className="template-source-video"
              controls
              playsInline
              preload="metadata"
              src={recording.playbackUrl}
            />
          ) : (
            <div className="recording-unavailable">
              <strong>Source video unavailable</strong>
              <p className="subtle-copy">
                This template flow needs a playable recording in the current browser.
              </p>
            </div>
          )}

          <div className="template-grid">
            {templates.map((template) => {
              const isSelected = processingState?.templateId === template.id;
              const needsRepTiming = !!template.requiresRepTiming;
              const canUseTemplate = recording.playbackUrl && (!needsRepTiming || hasRepTiming);

              return (
                <article key={template.id} className={`template-card ${isSelected ? "active" : ""}`}>
                  <div className="panel-header">
                    <div>
                      <strong>{template.name}</strong>
                      <p className="subtle-copy">{template.shortLabel}</p>
                    </div>
                    {editedVersion?.templateId === template.id ? (
                      <span className="pill">Ready</span>
                    ) : null}
                  </div>

                  <p className="subtle-copy">{template.description}</p>

                  <div className="chip-row">
                    {template.effects.map((effect) => (
                      <span key={effect} className="chip">
                        {effect}
                      </span>
                    ))}
                  </div>

                  {needsRepTiming && !hasRepTiming ? (
                    <div className="template-note">
                      <strong>Waiting for rep timing</strong>
                      <p className="subtle-copy">
                        This template uses backend rep analysis so the `+1` bubble lands in sync
                        with each completed rep.
                      </p>
                    </div>
                  ) : null}

                  {needsRepTiming &&
                  hasRepTiming &&
                  recording?.templateTimingSource === "live" ? (
                    <div className="template-note">
                      <strong>Using live rep timing</strong>
                      <p className="subtle-copy">
                        This edit will sync from the rep hits captured during recording because the
                        final backend re-score came back weaker than the live session.
                      </p>
                    </div>
                  ) : null}

                  {needsRepTiming &&
                  hasRepTiming &&
                  recording?.templateTimingSource === "estimated" ? (
                    <div className="template-note">
                      <strong>Using estimated rep spacing</strong>
                      <p className="subtle-copy">
                        Final rep count is available, but exact rep timestamps are being estimated
                        across the clip.
                      </p>
                    </div>
                  ) : null}

                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => onApplyTemplate(template.id)}
                    disabled={!canUseTemplate || isProcessing}
                  >
                    {isProcessing ? "Rendering..." : editedVersion?.templateId === template.id ? "Reapply Template" : "Use Template"}
                  </button>
                </article>
              );
            })}
          </div>

          {processingState?.recordingId === recording.id ? (
            <div className={`template-progress-card ${processingState.error ? "failed" : ""}`}>
              <div className="panel-header">
                <strong>{processingState.error ? "Template Failed" : "Rendering Edit"}</strong>
                <span>{Math.round(processingState.progress * 100)}%</span>
              </div>
              <div className="template-progress-track">
                <div
                  className="template-progress-fill"
                  style={{ width: `${Math.max(6, Math.round(processingState.progress * 100))}%` }}
                />
              </div>
              <p className="subtle-copy">
                {processingState.error ?? processingState.message}
              </p>
            </div>
          ) : null}

          {editedVersion ? (
            <div className="template-result-card">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Edited Result</p>
                  <h3>{editedVersion.templateName}</h3>
                </div>
                <a
                  className="secondary-button"
                  href={editedVersion.playbackUrl}
                  download={`${recording.userName.toLowerCase().replace(/\s+/g, "-")}-${editedVersion.templateId}.webm`}
                >
                  Download Edit
                </a>
              </div>
              <video
                className="template-result-video"
                controls
                playsInline
                preload="metadata"
                src={editedVersion.playbackUrl}
              />
            </div>
          ) : null}
        </>
      )}
    </Modal>
  );
}
