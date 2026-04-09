import { getVideoTemplates } from "../editing/videoTemplates";
import { formatDuration } from "../shared/lib/format";
import { RecordingLibraryItem, VideoTemplateId } from "../types";
import { TemplateProcessingState } from "../features/recording-library/model/types";
import { TemplatePreviewVideo } from "./TemplatePreviewVideo";
import { TemplateSamplePoster } from "./TemplateSamplePoster";

interface TemplateGalleryProps {
  recording: RecordingLibraryItem;
  processingStates: Partial<Record<VideoTemplateId, TemplateProcessingState>>;
  queuedTemplateIds: VideoTemplateId[];
  onStartRender: (templateId: VideoTemplateId) => void;
  onSelectTemplate: (templateId: VideoTemplateId) => void;
  onRetryTemplate: (templateId: VideoTemplateId) => void;
  compact?: boolean;
}

export function TemplateGallery({
  recording,
  processingStates,
  queuedTemplateIds,
  onStartRender,
  onSelectTemplate,
  onRetryTemplate,
  compact = false
}: TemplateGalleryProps) {
  const templates = getVideoTemplates();
  const hasRepTiming = (recording.templateRepCount ?? 0) > 0;
  const isPrimaryFamilyTemplate = (templateId: VideoTemplateId) =>
    templateId === "primary" || templateId === "primary-dhurandhar";
  const renderedVersionMap = new Map(
    recording.editedVersions.map((version) => [version.templateId, version])
  );

  return (
    <div className={`template-grid ${compact ? "template-grid-compact" : ""}`}>
      {templates.map((template) => {
        const renderedVersion = renderedVersionMap.get(template.id) ?? null;
        const isSelected = recording.selectedEditedTemplateId === template.id;
        const processingState = processingStates[template.id] ?? null;
        const isQueued = queuedTemplateIds.includes(template.id);
        const needsRepTiming = !!template.requiresRepTiming;
        const needsWeightInput = !!template.requiresWeightInput;
        const isUnavailable = needsRepTiming && !hasRepTiming;
        const isRendering =
          !!processingState && !processingState.error && processingState.progress < 1;
        const hasFailed = !!processingState?.error;

        return (
          <article
            key={template.id}
            className={`template-card ${isSelected ? "active" : ""} ${renderedVersion ? "ready" : ""}`}
          >
            <div className="panel-header">
              <div>
                <strong>{template.name}</strong>
                <p className="subtle-copy">{template.shortLabel}</p>
              </div>
              {isSelected ? <span className="pill">Chosen</span> : null}
            </div>

            <p className="subtle-copy">{template.description}</p>

            <div className="chip-row">
              {template.effects.map((effect) => (
                <span key={effect} className="chip">
                  {effect}
                </span>
              ))}
            </div>

            {renderedVersion ? (
              <div className="template-preview-card">
                <TemplatePreviewVideo
                  className="template-preview-video"
                  autoPlay
                  loop
                  src={renderedVersion.playbackUrl}
                />
                <div className="template-preview-meta">
                  <span>{formatDuration(recording.durationSec)}</span>
                  <span>
                    {isSelected ? "Previewing now" : "Tap preview below to inspect"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="template-preview-card">
                <TemplateSamplePoster templateId={template.id} />
                <div className="template-preview-meta">
                  <span>Sample look</span>
                  <span>Review before rendering</span>
                </div>
              </div>
            )}

            {isRendering ? (
              <div className="template-progress-card">
                <div className="panel-header">
                  <strong>Rendering</strong>
                  <span>{Math.round(processingState.progress * 100)}%</span>
                </div>
                <div className="template-progress-track">
                  <div
                    className="template-progress-fill"
                    style={{
                      width: `${Math.max(6, Math.round(processingState.progress * 100))}%`
                    }}
                  />
                </div>
                <p className="subtle-copy">{processingState.message}</p>
              </div>
            ) : null}

            {!renderedVersion && isQueued ? (
              <div className="template-note">
                <strong>Queued next</strong>
                <p className="subtle-copy">
                  This render is lined up and will start automatically as soon as the current
                  export finishes.
                </p>
              </div>
            ) : null}

            {isUnavailable ? (
              <div className="template-note">
                <strong>Waiting for rep timing</strong>
                <p className="subtle-copy">
                  This template needs rep timing before it can render in sync.
                </p>
              </div>
            ) : null}

            {needsRepTiming && hasRepTiming && recording.templateTimingSource === "live" ? (
              <div className="template-note">
                <strong>Using live rep timing</strong>
                <p className="subtle-copy">
                  This clip will sync from the rep hits captured during recording.
                </p>
              </div>
            ) : null}

            {needsRepTiming && hasRepTiming && recording.templateTimingSource === "estimated" ? (
              <div className="template-note">
                <strong>Using estimated rep spacing</strong>
                <p className="subtle-copy">
                  Final rep count is available, but exact timestamps are being estimated across
                  the clip.
                </p>
              </div>
            ) : null}

            {isPrimaryFamilyTemplate(template.id) ? (
              <div className="template-note">
                <strong>Primary renders as a pair</strong>
                <p className="subtle-copy">
                  Starting either Primary card will queue both soundtrack cuts so you can compare
                  them side by side.
                </p>
              </div>
            ) : null}

            {needsWeightInput ? (
              <div className="template-note">
                <strong>Weight needed before render</strong>
                <p className="subtle-copy">
                  You will be asked for the lifted weight as a number, and the video will show it
                  automatically in kilograms.
                </p>
              </div>
            ) : null}

            {!renderedVersion && hasFailed ? (
              <div className="template-progress-card failed">
                <div className="panel-header">
                  <strong>Render failed</strong>
                  <span>Retry available</span>
                </div>
                <p className="subtle-copy">{processingState?.error}</p>
              </div>
            ) : null}

            {renderedVersion ? (
              <button
                className={isSelected ? "secondary-button" : "primary-button"}
                type="button"
                onClick={() => onSelectTemplate(template.id)}
                disabled={isSelected}
              >
                {isSelected ? "Previewing" : "Open Preview"}
              </button>
            ) : hasFailed ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => onRetryTemplate(template.id)}
              >
                Retry Render
              </button>
            ) : !isRendering && !isQueued && !isUnavailable ? (
              <button
                className="primary-button"
                type="button"
                onClick={() => onStartRender(template.id)}
              >
                {needsWeightInput
                  ? "Enter Weight & Render"
                  : isPrimaryFamilyTemplate(template.id)
                    ? "Render Both Cuts"
                    : "Start Render"}
              </button>
            ) : (
              <div className="template-status-inline">
                {isRendering
                  ? "Rendering now"
                  : isQueued
                    ? "Queued up"
                    : isUnavailable
                      ? "Unavailable for this clip"
                      : "Preparing"}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
