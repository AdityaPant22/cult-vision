import { TemplateProcessingState } from "../features/recording-library/model/types";
import { formatDuration } from "../shared/lib/format";
import { RecordingLibraryItem, VideoTemplateId } from "../types";
import { Modal } from "./Modal";
import { TemplateGallery } from "./TemplateGallery";
import { TemplatePreviewVideo } from "./TemplatePreviewVideo";

interface TemplatesModalProps {
  open: boolean;
  recording: RecordingLibraryItem | null;
  processingStates: Partial<Record<VideoTemplateId, TemplateProcessingState>>;
  queuedTemplateIds: VideoTemplateId[];
  onStartRender: (templateId: VideoTemplateId) => void;
  onSelectTemplate: (templateId: VideoTemplateId) => void;
  onRetryTemplate: (templateId: VideoTemplateId) => void;
  onClose: () => void;
}

export function TemplatesModal({
  open,
  recording,
  processingStates,
  queuedTemplateIds,
  onStartRender,
  onSelectTemplate,
  onRetryTemplate,
  onClose
}: TemplatesModalProps) {
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
                {formatDuration(recording.durationSec)} •{" "}
                {new Date(recording.startedAt).toLocaleString()}
              </p>
            </div>
            <span className={`status-pill ${recording.status}`}>{recording.status}</span>
          </div>

          {recording.playbackUrl ? (
            <TemplatePreviewVideo
              className="template-source-video"
              controls
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

          <div className="template-section-header">
            <div>
              <p className="eyebrow">Template Samples</p>
              <h3>Preview the look, then start rendering the ones you want</h3>
            </div>
            {recording.editedVersion ? (
              <a
                className="secondary-button"
                href={recording.editedVersion.playbackUrl}
                download={`${recording.userName.toLowerCase().replace(/\s+/g, "-")}-${recording.editedVersion.templateId}.webm`}
              >
                Download Chosen Edit
              </a>
            ) : null}
          </div>

          {recording.editedVersion ? (
            <div className="template-result-card">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Current Preview</p>
                  <h3>{recording.editedVersion.templateName}</h3>
                </div>
                <span className="pill">Active Preview</span>
              </div>
              <TemplatePreviewVideo
                className="template-result-video"
                controls
                autoPlay
                loop
                src={recording.editedVersion.playbackUrl}
              />
            </div>
          ) : null}

          <TemplateGallery
            recording={recording}
            processingStates={processingStates}
            queuedTemplateIds={queuedTemplateIds}
            onStartRender={onStartRender}
            onSelectTemplate={onSelectTemplate}
            onRetryTemplate={onRetryTemplate}
          />
        </>
      )}
    </Modal>
  );
}
