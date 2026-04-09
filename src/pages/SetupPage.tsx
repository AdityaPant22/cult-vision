import { useEffect, useMemo, useRef, useState } from "react";
import { SquatSilhouetteGuide } from "../components/SquatSilhouetteGuide";
import {
  DEFAULT_SILHOUETTE_GUIDE_SETTINGS,
  loadSilhouetteGuideSettings,
  saveSilhouetteGuideSettings,
  sanitizeSilhouetteGuideSettings,
  SilhouetteGuideSettings
} from "../features/silhouette-guide/model/guideSettings";

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1080 },
    height: { ideal: 1920 },
    aspectRatio: { ideal: 9 / 16 },
    facingMode: { ideal: "environment" }
  },
  audio: false
};

type AxisKey = keyof SilhouetteGuideSettings;

interface AxisConfig {
  key: AxisKey;
  label: string;
  min: number;
  max: number;
  step: number;
  helper: string;
}

const AXIS_CONFIG: AxisConfig[] = [
  {
    key: "offsetX",
    label: "X Axis",
    min: -30,
    max: 30,
    step: 1,
    helper: "Move the silhouette left or right in the frame."
  },
  {
    key: "offsetY",
    label: "Y Axis",
    min: -25,
    max: 25,
    step: 1,
    helper: "Move the silhouette up or down in the frame."
  },
  {
    key: "scale",
    label: "Z Axis",
    min: 60,
    max: 145,
    step: 1,
    helper: "Adjust perceived depth by making the silhouette smaller or larger."
  }
];

export function SetupPage() {
  const [draftSettings, setDraftSettings] = useState<SilhouetteGuideSettings>(() =>
    loadSilhouetteGuideSettings()
  );
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const hasChanges = useMemo(() => {
    const saved = loadSilhouetteGuideSettings();
    return JSON.stringify(saved) !== JSON.stringify(draftSettings);
  }, [draftSettings]);

  useEffect(() => {
    let activeStream: MediaStream | null = null;

    const startPreview = async () => {
      try {
        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
          throw new Error("Camera access is not available in this browser.");
        }

        activeStream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        setPreviewStream(activeStream);
        setCameraError(null);
      } catch (error) {
        setCameraError(
          error instanceof Error ? error.message : "Unable to start the setup camera preview."
        );
      }
    };

    void startPreview();

    return () => {
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

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

  const updateAxis = (key: AxisKey, nextValue: number) => {
    setDraftSettings((current) =>
      sanitizeSilhouetteGuideSettings({
        ...current,
        [key]: nextValue
      })
    );
    setSaveState("idle");
  };

  const handleSave = () => {
    saveSilhouetteGuideSettings(draftSettings);
    setDraftSettings(loadSilhouetteGuideSettings());
    setSaveState("saved");
  };

  const handleReset = () => {
    setDraftSettings(DEFAULT_SILHOUETTE_GUIDE_SETTINGS);
    setSaveState("idle");
  };

  return (
    <section className="screen setup-screen">
      <div className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Setup</p>
            <h1>Silhouette Alignment</h1>
          </div>
          <span className="pill">
            {saveState === "saved" ? "Saved" : hasChanges ? "Unsaved" : "Ready"}
          </span>
        </div>
        <p className="subtle-copy">
          Adjust the guide until the silhouette matches where you want squat users to stand.
          When you save, this alignment becomes the default everywhere the white guide is shown.
        </p>
      </div>

      <div className="setup-grid">
        <div className="panel setup-preview-panel">
          <div className="panel-header">
            <div>
              <h2>Live Camera Preview</h2>
              <p className="subtle-copy">
                Match the silhouette to the athlete position you want in the real recording flow.
              </p>
            </div>
          </div>

          <div className="preview-frame preview-frame-large recording-preview-shell setup-preview-shell">
            {previewStream ? (
              <>
                <video ref={videoRef} className="camera-video" autoPlay muted playsInline />
                <SquatSilhouetteGuide
                  settings={draftSettings}
                  helperTitle="Adjust the guide until it feels right"
                  helperText="Save this and the same placement will be used during squat recording."
                />
              </>
            ) : (
              <span>{cameraError ?? "Starting setup camera..."}</span>
            )}
          </div>
        </div>

        <div className="panel setup-controls-panel">
          <div className="panel-header">
            <div>
              <h2>Position Controls</h2>
              <p className="subtle-copy">
                Use the sliders to move or scale the silhouette before saving.
              </p>
            </div>
          </div>

          <div className="setup-slider-list">
            {AXIS_CONFIG.map((axis) => (
              <label key={axis.key} className="setup-slider-card">
                <div className="setup-slider-header">
                  <strong>{axis.label}</strong>
                  <span>{Math.round(draftSettings[axis.key])}</span>
                </div>
                <input
                  className="setup-slider"
                  type="range"
                  min={axis.min}
                  max={axis.max}
                  step={axis.step}
                  value={draftSettings[axis.key]}
                  onChange={(event) => updateAxis(axis.key, Number(event.target.value))}
                />
                <span className="subtle-copy">{axis.helper}</span>
              </label>
            ))}
          </div>

          <div className="action-grid">
            <button className="secondary-button" type="button" onClick={handleReset}>
              Reset
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={handleSave}
              disabled={!hasChanges}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
