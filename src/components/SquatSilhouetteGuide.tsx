import squatSilhouette from "../assets/squat-silhouette.png";
import {
  DEFAULT_SILHOUETTE_GUIDE_SETTINGS,
  getSilhouetteGuideStyle,
  SilhouetteGuideSettings
} from "../features/silhouette-guide/model/guideSettings";

interface SquatSilhouetteGuideProps {
  settings?: SilhouetteGuideSettings;
  helperTitle?: string;
  helperText?: string;
  showCopy?: boolean;
}

export function SquatSilhouetteGuide({
  settings = DEFAULT_SILHOUETTE_GUIDE_SETTINGS,
  helperTitle = "Stand inside the white guide",
  helperText = "Match this squat setup: 45 degree stance to camera, bar on upper back.",
  showCopy = true
}: SquatSilhouetteGuideProps) {
  return (
    <div className="framing-guide-overlay" aria-hidden="true">
      <img
        className="framing-guide-silhouette"
        style={getSilhouetteGuideStyle(settings)}
        src={squatSilhouette}
        alt=""
      />
      {showCopy ? (
        <div className="framing-guide-copy">
          <strong>{helperTitle}</strong>
          <span>{helperText}</span>
        </div>
      ) : null}
    </div>
  );
}
