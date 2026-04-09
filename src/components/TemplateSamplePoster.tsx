import { VideoTemplateId } from "../types";

interface TemplateSamplePosterProps {
  templateId: VideoTemplateId;
}

function getSampleTitle(templateId: VideoTemplateId) {
  switch (templateId) {
    case "primary":
      return "Auto-trim set cut";
    case "cult-eidos":
      return "Editorial coaching reel";
    case "depth-drive":
      return "Warm cinematic lift";
    case "iron-echo":
      return "Monochrome studio finish";
    case "arena-lift":
      return "Coaching rail layout";
    case "rep-bingo":
      return "Subtle rep accents";
    default:
      return "Minimal premium cut";
  }
}

export function TemplateSamplePoster({ templateId }: TemplateSamplePosterProps) {
  return (
    <div className={`template-sample template-sample-${templateId}`}>
      <div className="template-sample-top">
        <span className="template-sample-pill">Cult Vision</span>
        <span className="template-sample-pill">{getSampleTitle(templateId)}</span>
      </div>

      <div className="template-sample-stage">
        <div className="template-sample-silhouette" />
        {templateId === "primary" ? (
          <>
            <div className="template-sample-window" />
            <div className="template-sample-trimline template-sample-trimline-left" />
            <div className="template-sample-trimline template-sample-trimline-right" />
          </>
        ) : null}
        {templateId === "rep-bingo" ? <div className="template-sample-bubble">+1</div> : null}
        {templateId === "depth-drive" ? <div className="template-sample-grid" /> : null}
        {templateId === "iron-echo" ? (
          <>
            <div className="template-sample-echo template-sample-echo-left" />
            <div className="template-sample-echo template-sample-echo-right" />
          </>
        ) : null}
        {templateId === "arena-lift" ? <div className="template-sample-flare" /> : null}
      </div>

      <div className="template-sample-bottom">
        <div className="template-sample-chip-row">
          {templateId === "primary" ? (
            <>
              <span className="template-sample-chip ok">Auto Trim</span>
              <span className="template-sample-chip ok">1s Lead-in</span>
              <span className="template-sample-chip warn">1s Tail</span>
            </>
          ) : templateId === "cult-eidos" ? (
            <>
              <span className="template-sample-chip ok">Back Flat</span>
              <span className="template-sample-chip warn">Hip Hinge</span>
              <span className="template-sample-chip warn">Lock Out</span>
            </>
          ) : templateId === "iron-echo" ? (
            <>
              <span className="template-sample-chip ok">Monochrome</span>
              <span className="template-sample-chip ok">Contrast</span>
              <span className="template-sample-chip warn">Studio Frame</span>
            </>
          ) : templateId === "arena-lift" ? (
            <>
              <span className="template-sample-chip ok">Tempo</span>
              <span className="template-sample-chip ok">Rail</span>
              <span className="template-sample-chip warn">Coach Note</span>
            </>
          ) : (
            <>
              <span className="template-sample-chip ok">Clean Grade</span>
              <span className="template-sample-chip ok">Minimal UI</span>
              <span className="template-sample-chip warn">Export Ready</span>
            </>
          )}
        </div>

        <strong className="template-sample-title">
          {templateId === "primary"
            ? "Primary"
            : templateId === "cult-eidos"
            ? "Barbell Squat"
            : templateId === "gym-highlight"
              ? "Strength Session"
              : templateId === "iron-echo"
                ? "Noir Studio"
                : templateId === "arena-lift"
                  ? "Coach Notes"
                  : templateId === "depth-drive"
                    ? "Amber Frame"
                    : "Rep Marks"}
        </strong>
        <span className="template-sample-subtitle">
          {templateId === "primary"
            ? "working set only."
            : templateId === "cult-eidos"
            ? "done right."
            : templateId === "gym-highlight"
              ? "cleanly captured."
              : getSampleTitle(templateId)}
        </span>
      </div>
    </div>
  );
}
