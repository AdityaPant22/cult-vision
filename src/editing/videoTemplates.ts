import { RecordingRepEvent, VideoTemplateId } from "../types";
import primaryTemplateTrackUrl from "../assets/primary-template-track.mp3";
import primaryTemplateTrackDhurandharUrl from "../assets/primary-template-track-dhurandhar.mp3";
import cultLogoUrl from "../assets/cult-logo.jpeg";

export interface VideoTemplateDefinition {
  id: VideoTemplateId;
  name: string;
  shortLabel: string;
  description: string;
  effects: string[];
  requiresRepTiming?: boolean;
}

export interface TemplateRenderProgress {
  progress: number;
  message: string;
}

export interface TemplateRenderResult {
  blob: Blob;
  mimeType: string;
  templateId: VideoTemplateId;
  templateName: string;
}

type FaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FaceDetectorLike = {
  detect: (input: CanvasImageSource) => Promise<Array<{ boundingBox: FaceBounds }>>;
};

declare global {
  interface Window {
    FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;
  }
}

const PRIMARY_TEMPLATE_IDS = ["primary", "primary-dhurandhar"] as const;

function isPrimaryTemplateId(templateId: VideoTemplateId): templateId is (typeof PRIMARY_TEMPLATE_IDS)[number] {
  return PRIMARY_TEMPLATE_IDS.includes(templateId as (typeof PRIMARY_TEMPLATE_IDS)[number]);
}

function getPrimaryTrackSourceUrl(templateId: VideoTemplateId): string {
  return templateId === "primary-dhurandhar"
    ? primaryTemplateTrackDhurandharUrl
    : primaryTemplateTrackUrl;
}

const loadCultLogoImage = createImageLoader(cultLogoUrl);

const TEMPLATE_DEFINITIONS: VideoTemplateDefinition[] = [
  {
    id: "primary",
    name: "Primary / Track 1",
    shortLabel: "Auto-trim hero cut",
    description:
      "Trims to the working set, gives the final rep a slow-motion hero beat, and lays in a music bed with a premium vertical story layout.",
    effects: ["Auto cull", "Last rep slow-mo", "Track 1", "Hero layout"],
    requiresRepTiming: true
  },
  {
    id: "primary-dhurandhar",
    name: "Primary / Dhurandhar",
    shortLabel: "Auto-trim hero cut",
    description:
      "The same Primary hero cut, now rendered against the Dhurandhar soundtrack so you can choose the stronger music match.",
    effects: ["Auto cull", "Last rep slow-mo", "Dhurandhar track", "Hero layout"],
    requiresRepTiming: true
  },
  {
    id: "cult-eidos",
    name: "Lift Story",
    shortLabel: "Editorial coaching reel",
    description:
      "A premium story-style edit with coaching pills, a polished dark grade, and a refined title finish.",
    effects: ["Editorial pills", "Dark premium grade", "Story finish", "Coach card"]
  },
  {
    id: "depth-drive",
    name: "Amber Frame",
    shortLabel: "Warm cinematic lift",
    description:
      "A warm, cinematic cut with a rich amber grade, elegant title block, and understated performance feel.",
    effects: ["Warm grade", "Elegant footer", "Soft vignette", "Cinematic finish"]
  },
  {
    id: "iron-echo",
    name: "Noir Motion",
    shortLabel: "Monochrome studio finish",
    description:
      "A monochrome studio look with crisp contrast, subtle borders, and a clean premium caption treatment.",
    effects: ["Monochrome grade", "Thin frame", "Studio caption", "High contrast"]
  },
  {
    id: "arena-lift",
    name: "Coach Slate",
    shortLabel: "Performance rail edit",
    description:
      "A modern coaching layout with a clean stat rail, cool blue finish, and subtle performance cues.",
    effects: ["Cool stat rail", "Performance panel", "Blue accents", "Modern coaching look"]
  },
  {
    id: "gym-highlight",
    name: "Clean Strength",
    shortLabel: "Minimal premium cut",
    description:
      "A clean, minimal export with crisp framing, tasteful copy, and a premium gym-grade finish.",
    effects: ["Clean lower third", "Face-aware framing", "Soft contrast", "Minimal overlay"]
  },
  {
    id: "rep-bingo",
    name: "Rep Marks",
    shortLabel: "Subtle rep accents",
    description:
      "Adds tasteful rep accents with synced micro-pops and a lightweight chime whenever a rep lands.",
    effects: ["Rep micro-pop", "Soft chime", "Rep counter", "Minimal overlay"],
    requiresRepTiming: true
  }
];

function createHiddenVideo(sourceUrl: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.src = sourceUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  return video;
}

function createAudioBufferLoader(audioContext: AudioContext, sourceUrl: string) {
  let cachedPromise: Promise<AudioBuffer> | null = null;

  return async () => {
    if (!cachedPromise) {
      cachedPromise = fetch(sourceUrl)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error("Could not load the soundtrack for this template.");
          }

          return response.arrayBuffer();
        })
        .then((buffer) => audioContext.decodeAudioData(buffer.slice(0)));
    }

    return cachedPromise;
  };
}

function createImageLoader(sourceUrl: string) {
  let cachedPromise: Promise<HTMLImageElement> | null = null;

  return async () => {
    if (!cachedPromise) {
      cachedPromise = new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not load the image for this template."));
        image.src = sourceUrl;
      });
    }

    return cachedPromise;
  };
}

function waitForEvent(
  target: HTMLMediaElement,
  eventName: "loadedmetadata" | "ended"
): Promise<void> {
  if (eventName === "loadedmetadata" && target.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleResolve = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Could not prepare the recording for editing."));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, handleResolve);
      target.removeEventListener("error", handleError);
    };

    target.addEventListener(eventName, handleResolve, { once: true });
    target.addEventListener("error", handleError, { once: true });
  });
}

function seekVideo(target: HTMLVideoElement, timeSec: number): Promise<void> {
  if (!Number.isFinite(timeSec)) {
    return Promise.resolve();
  }

  const safeTargetTime = Math.max(0, timeSec);
  if (Math.abs(target.currentTime - safeTargetTime) < 0.04) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Could not seek the source video for template trimming."));
    };
    const cleanup = () => {
      target.removeEventListener("seeked", handleSeeked);
      target.removeEventListener("error", handleError);
    };

    target.addEventListener("seeked", handleSeeked, { once: true });
    target.addEventListener("error", handleError, { once: true });
    target.currentTime = safeTargetTime;
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function easeOutCubic(value: number): number {
  const t = clamp(value, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(value: number): number {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function getRampEnvelope(
  timeSec: number,
  startSec: number,
  peakStartSec: number,
  peakEndSec: number,
  endSec: number
): number {
  if (timeSec <= startSec || timeSec >= endSec) {
    return 0;
  }

  if (timeSec < peakStartSec) {
    return easeOutCubic((timeSec - startSec) / Math.max(0.001, peakStartSec - startSec));
  }

  if (timeSec <= peakEndSec) {
    return 1;
  }

  return 1 - easeInOutQuad((timeSec - peakEndSec) / Math.max(0.001, endSec - peakEndSec));
}

function getTemplateDefinition(templateId: VideoTemplateId): VideoTemplateDefinition {
  return TEMPLATE_DEFINITIONS.find((template) => template.id === templateId) ?? TEMPLATE_DEFINITIONS[0];
}

function getSupportedRenderMimeType(): string {
  const candidates = ["video/webm;codecs=vp8", "video/webm", "video/webm;codecs=vp9"];

  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) {
    throw new Error("This browser cannot export edited video templates yet.");
  }

  return mimeType;
}

function getOutputSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const portraitHeight = Math.max(sourceWidth, sourceHeight);
  const targetHeight = Math.min(960, Math.max(720, Math.round(portraitHeight)));
  const evenHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1;
  const targetWidth = Math.round((evenHeight * 9) / 16);
  const evenWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth - 1;
  return {
    width: evenWidth,
    height: evenHeight
  };
}

function getCropRect(params: {
  video: HTMLVideoElement;
  canvasWidth: number;
  canvasHeight: number;
  focusX: number;
  focusY: number;
  zoom: number;
}) {
  const { video, canvasWidth, canvasHeight, focusX, focusY, zoom } = params;
  const sourceWidth = video.videoWidth || canvasWidth;
  const sourceHeight = video.videoHeight || canvasHeight;
  const targetAspect = 9 / 16;
  const sourceAspect = sourceWidth / sourceHeight;

  let cropWidth = sourceWidth / zoom;
  let cropHeight = sourceHeight / zoom;

  if (sourceAspect > targetAspect) {
    cropHeight = sourceHeight / zoom;
    cropWidth = cropHeight * targetAspect;
  } else {
    cropWidth = sourceWidth / zoom;
    cropHeight = cropWidth / targetAspect;
  }

  const cropX = clamp(sourceWidth * focusX - cropWidth / 2, 0, sourceWidth - cropWidth);
  const cropY = clamp(sourceHeight * focusY - cropHeight / 2, 0, sourceHeight - cropHeight);

  return {
    sourceWidth,
    sourceHeight,
    cropX,
    cropY,
    cropWidth,
    cropHeight
  };
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawPerspectiveGrid(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  strength: number;
}) {
  const { context, canvasWidth, canvasHeight, strength } = params;
  if (strength <= 0.01) {
    return;
  }

  const horizonY = canvasHeight * 0.58;
  context.save();
  context.globalAlpha = clamp(0.12 + strength * 0.22, 0, 0.34);
  context.strokeStyle = "rgba(255, 201, 110, 0.78)";
  context.lineWidth = 1.2;

  for (let line = 0; line < 7; line += 1) {
    const t = line / 6;
    const y = lerp(canvasHeight * 0.8, horizonY, t * t);
    context.beginPath();
    context.moveTo(canvasWidth * 0.12, y);
    context.lineTo(canvasWidth * 0.88, y);
    context.stroke();
  }

  for (let line = 0; line < 8; line += 1) {
    const t = line / 7;
    const x = lerp(canvasWidth * 0.14, canvasWidth * 0.86, t);
    context.beginPath();
    context.moveTo(x, canvasHeight);
    context.lineTo(canvasWidth * 0.5, horizonY);
    context.stroke();
  }

  context.restore();
}

function drawPowerPulse(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  strength: number;
}) {
  const { context, canvasWidth, canvasHeight, strength } = params;
  if (strength <= 0.01) {
    return;
  }

  const cx = canvasWidth * 0.5;
  const cy = canvasHeight * 0.72;
  const radius = canvasWidth * (0.12 + strength * 0.18);

  context.save();
  context.globalAlpha = clamp(strength * 0.72, 0, 0.72);
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fillStyle = "rgba(255, 188, 92, 0.18)";
  context.fill();

  context.lineWidth = 8;
  context.strokeStyle = `rgba(255, 212, 130, ${0.36 + strength * 0.34})`;
  context.stroke();
  context.restore();
}

function drawArenaSpotlight(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  strength: number;
}) {
  const { context, canvasWidth, canvasHeight, strength } = params;
  const gradient = context.createRadialGradient(
    canvasWidth * 0.5,
    canvasHeight * 0.36,
    canvasWidth * 0.06,
    canvasWidth * 0.5,
    canvasHeight * 0.5,
    canvasWidth * 0.78
  );
  gradient.addColorStop(0, `rgba(255, 248, 221, ${0.12 + strength * 0.18})`);
  gradient.addColorStop(0.5, "rgba(255, 248, 221, 0.04)");
  gradient.addColorStop(1, "rgba(5, 7, 9, 0.46)");
  context.save();
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  context.restore();
}

function drawBroadcastLowerThird(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  completedRepCount: number;
}) {
  const { context, canvasWidth, canvasHeight, completedRepCount } = params;
  const width = Math.min(canvasWidth * 0.5, 320);
  const height = 86;
  const x = 22;
  const y = canvasHeight - height - 20;

  drawRoundedRect(context, x, y, width, height, 22);
  context.fillStyle = "rgba(10, 12, 15, 0.72)";
  context.fill();
  context.strokeStyle = "rgba(124, 208, 255, 0.32)";
  context.lineWidth = 1.5;
  context.stroke();

  context.fillStyle = "rgba(124, 208, 255, 0.95)";
  context.font = "800 14px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("ARENA LIFT", x + 18, y + 28);

  context.fillStyle = "#f4f4ef";
  context.font = "700 18px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("SQUAT SET", x + 18, y + 54);

  context.fillStyle = "#d2ff72";
  context.font = "800 26px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(`${completedRepCount} reps`, x + 18, y + 78);
}

function drawDiagonalAccent(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
}) {
  const { context, canvasWidth, canvasHeight } = params;
  context.save();
  context.globalAlpha = 0.22;
  context.fillStyle = "rgba(140, 217, 255, 0.3)";
  context.beginPath();
  context.moveTo(canvasWidth * 0.68, 0);
  context.lineTo(canvasWidth, 0);
  context.lineTo(canvasWidth, canvasHeight * 0.28);
  context.closePath();
  context.fill();
  context.restore();
}

function drawSweepFlare(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  strength: number;
}) {
  const { context, canvasWidth, canvasHeight, strength } = params;
  if (strength <= 0.01) {
    return;
  }

  context.save();
  context.globalAlpha = clamp(strength * 0.58, 0, 0.58);
  const gradient = context.createLinearGradient(0, canvasHeight * 0.25, canvasWidth, canvasHeight * 0.62);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.26)");
  gradient.addColorStop(0.55, "rgba(124,208,255,0.56)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, canvasHeight * 0.22, canvasWidth, canvasHeight * 0.44);
  context.restore();
}

function createFaceDetector(): FaceDetectorLike | null {
  if (typeof window === "undefined" || !window.FaceDetector) {
    return null;
  }

  try {
    return new window.FaceDetector({
      fastMode: true,
      maxDetectedFaces: 1
    });
  } catch {
    return null;
  }
}

function drawBaseVideoFrame(params: {
  context: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  canvasWidth: number;
  canvasHeight: number;
  focusX: number;
  focusY: number;
  zoom: number;
}) {
  const { context, video, canvasWidth, canvasHeight, focusX, focusY, zoom } = params;
  const crop = getCropRect({
    video,
    canvasWidth,
    canvasHeight,
    focusX,
    focusY,
    zoom
  });

  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.filter = "contrast(1.18) saturate(1.18) brightness(1.05)";
  context.drawImage(
    video,
    crop.cropX,
    crop.cropY,
    crop.cropWidth,
    crop.cropHeight,
    0,
    0,
    canvasWidth,
    canvasHeight
  );

  context.globalAlpha = 0.14;
  context.filter = "contrast(1.32) saturate(1.08)";
  context.drawImage(
    video,
    crop.cropX,
    crop.cropY,
    crop.cropWidth,
    crop.cropHeight,
    -canvasWidth * 0.01,
    -canvasHeight * 0.01,
    canvasWidth * 1.02,
    canvasHeight * 1.02
  );

  context.globalAlpha = 1;
  context.filter = "none";

  const vignette = context.createRadialGradient(
    canvasWidth * 0.5,
    canvasHeight * 0.45,
    canvasWidth * 0.14,
    canvasWidth * 0.5,
    canvasHeight * 0.5,
    canvasWidth * 0.76
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(7, 9, 10, 0.38)");
  context.fillStyle = vignette;
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  const topGlow = context.createLinearGradient(0, 0, canvasWidth, canvasHeight * 0.4);
  topGlow.addColorStop(0, "rgba(210, 255, 114, 0.12)");
  topGlow.addColorStop(1, "rgba(210, 255, 114, 0)");
  context.fillStyle = topGlow;
  context.fillRect(0, 0, canvasWidth, canvasHeight * 0.45);

  return crop;
}

function drawCornerBadge(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  label: string;
  subtitle: string;
}) {
  const { context, canvasWidth, label, subtitle } = params;
  const badgeWidth = Math.min(280, canvasWidth * 0.48);
  drawRoundedRect(context, 18, 18, badgeWidth, 58, 18);
  context.fillStyle = "rgba(17, 21, 24, 0.7)";
  context.fill();
  context.strokeStyle = "rgba(210, 255, 114, 0.28)";
  context.lineWidth = 1.5;
  context.stroke();

  context.fillStyle = "#d2ff72";
  context.font = "700 14px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(label, 34, 42);
  context.fillStyle = "rgba(244, 244, 239, 0.88)";
  context.font = "600 16px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(subtitle, 34, 63);
}

function drawRepBubble(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  strength: number;
  bubbleText: string;
}) {
  const { context, canvasWidth, canvasHeight, strength, bubbleText } = params;
  if (strength <= 0.01) {
    return;
  }

  const cx = canvasWidth * 0.8;
  const cy = canvasHeight * 0.28 - strength * 12;
  const radius = 62 + strength * 22;

  context.save();
  context.globalAlpha = clamp(strength * 1.1, 0, 1);

  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fillStyle = "rgba(210, 255, 114, 0.95)";
  context.fill();

  context.beginPath();
  context.arc(cx, cy, radius + 10, 0, Math.PI * 2);
  context.strokeStyle = `rgba(210, 255, 114, ${0.22 + strength * 0.4})`;
  context.lineWidth = 6;
  context.stroke();

  context.fillStyle = "#111315";
  context.textAlign = "center";
  context.font = `800 ${Math.round(38 + strength * 10)}px 'Avenir Next', 'Segoe UI', sans-serif`;
  context.fillText(bubbleText, cx, cy + 14);
  context.restore();
}

function drawRepScoreboard(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  totalReps: number;
}) {
  const { context, canvasWidth, canvasHeight, totalReps } = params;
  const width = Math.min(220, canvasWidth * 0.36);
  const height = 88;
  const x = canvasWidth - width - 22;
  const y = canvasHeight - height - 24;

  drawRoundedRect(context, x, y, width, height, 22);
  context.fillStyle = "rgba(17, 21, 24, 0.76)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.1)";
  context.lineWidth = 1.5;
  context.stroke();

  context.fillStyle = "rgba(244, 244, 239, 0.72)";
  context.font = "700 14px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("REP COUNT", x + 22, y + 28);
  context.fillStyle = "#d2ff72";
  context.font = "800 40px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(String(totalReps), x + 22, y + 70);
}

function drawStatusPill(params: {
  context: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  label: string;
  accent?: string;
  align?: "left" | "right";
}) {
  const { context, x, y, width, label, accent = "#ef4d65", align = "left" } = params;
  drawRoundedRect(context, x, y, width, 42, 20);
  context.fillStyle = "rgba(12, 15, 19, 0.82)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.lineWidth = 1.2;
  context.stroke();

  context.fillStyle = accent;
  context.beginPath();
  context.arc(x + 18, y + 21, 4, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = "#f4f4ef";
  context.font = "700 14px 'Avenir Next', 'Segoe UI', sans-serif";
  context.textAlign = params.align === "right" ? "right" : "left";
  context.fillText(label, params.align === "right" ? x + width - 14 : x + 30, y + 26);
  context.textAlign = "left";
}

function drawMetricChip(params: {
  context: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  label: string;
  status: "ok" | "locked";
}) {
  const { context, x, y, width, label, status } = params;
  drawRoundedRect(context, x, y, width, 40, 16);
  context.fillStyle = "rgba(11, 16, 18, 0.84)";
  context.fill();
  context.strokeStyle =
    status === "ok" ? "rgba(53, 231, 131, 0.35)" : "rgba(255, 214, 102, 0.18)";
  context.lineWidth = 1.2;
  context.stroke();

  context.fillStyle = status === "ok" ? "#49dc85" : "#e0c26e";
  const prefix = status === "ok" ? "✓" : "•";
  const chipText = `${prefix} ${label.toUpperCase()}`;
  let fontSize = 14;
  let measuredWidth = Number.POSITIVE_INFINITY;

  while (fontSize >= 11) {
    context.font = `700 ${fontSize}px 'Avenir Next', 'Segoe UI', sans-serif`;
    measuredWidth = context.measureText(chipText).width;
    if (measuredWidth <= width - 22) {
      break;
    }
    fontSize -= 1;
  }

  context.textAlign = "center";
  context.fillText(chipText, x + width / 2, y + 25);
  context.textAlign = "left";
}

function drawPrimaryLogoBadge(params: {
  context: CanvasRenderingContext2D;
  logoImage: CanvasImageSource | null;
}) {
  const { context, logoImage } = params;
  const badgeX = 20;
  const badgeY = 14;
  const badgeSize = 54;

  drawRoundedRect(context, badgeX, badgeY, badgeSize, badgeSize, 18);
  context.fillStyle = "rgba(8, 10, 12, 0.9)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.lineWidth = 1.2;
  context.stroke();

  if (!logoImage) {
    return;
  }

  context.save();
  drawRoundedRect(context, badgeX, badgeY, badgeSize, badgeSize, 18);
  context.clip();
  context.drawImage(logoImage, badgeX + 3, badgeY + 3, badgeSize - 6, badgeSize - 6);
  context.restore();
}

function drawPrimaryRepCounter(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  completedRepCount: number;
  pulseStrength: number;
}) {
  const { context, canvasWidth, completedRepCount, pulseStrength } = params;
  const x = canvasWidth - 144;
  const y = 18;
  const width = 124;
  const height = 42;
  const emojiScale = 1 + pulseStrength * 0.28;
  const repText = `${completedRepCount} reps`;

  drawRoundedRect(context, x, y, width, height, 20);
  context.fillStyle = "rgba(12, 15, 19, 0.82)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.lineWidth = 1.2;
  context.stroke();

  if (pulseStrength > 0.01) {
    context.save();
    context.globalAlpha = 0.18 + pulseStrength * 0.18;
    context.fillStyle = "#ff8a3d";
    context.beginPath();
    context.arc(x + width * 0.66, y + 21, 13 + pulseStrength * 10, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  const repFont = "700 14px 'Avenir Next', 'Segoe UI', sans-serif";
  const emojiFont = "700 14px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  const emojiGap = 6;

  context.fillStyle = "#f4f4ef";
  context.font = repFont;
  const repTextWidth = context.measureText(repText).width;
  context.font = emojiFont;
  const emojiWidth = context.measureText("🔥").width;
  const totalContentWidth = repTextWidth + emojiGap + emojiWidth;
  const contentStartX = x + width / 2 - totalContentWidth / 2;
  const baselineY = y + 26;

  context.font = repFont;
  context.textAlign = "left";
  context.fillText(repText, contentStartX, baselineY);

  context.save();
  context.translate(contentStartX + repTextWidth + emojiGap + emojiWidth / 2, y + 24);
  context.scale(emojiScale, emojiScale);
  context.font = emojiFont;
  context.textAlign = "center";
  context.fillText("🔥", 0, 0);
  context.restore();

  context.textAlign = "left";
}

function drawPrimaryOverlay(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  completedRepCount: number;
  titleText: string;
  subjectName: string;
  logoImage: CanvasImageSource | null;
  repPulseStrength: number;
}) {
  const {
    context,
    canvasWidth,
    canvasHeight,
    completedRepCount,
    titleText,
    logoImage,
    repPulseStrength
  } = params;
  drawPrimaryLogoBadge({
    context,
    logoImage
  });
  drawPrimaryRepCounter({
    context,
    canvasWidth,
    completedRepCount,
    pulseStrength: repPulseStrength
  });

  const wash = context.createLinearGradient(0, canvasHeight * 0.54, 0, canvasHeight);
  wash.addColorStop(0, "rgba(5, 8, 11, 0)");
  wash.addColorStop(0.36, "rgba(5, 8, 11, 0.34)");
  wash.addColorStop(1, "rgba(5, 8, 11, 0.92)");
  context.fillStyle = wash;
  context.fillRect(0, canvasHeight * 0.52, canvasWidth, canvasHeight * 0.48);

  const chipY = canvasHeight * 0.69;
  const chipGap = 10;
  const chipStartX = 20;
  const chipWidth = Math.floor((canvasWidth - chipStartX * 2 - chipGap * 2) / 3);
  drawMetricChip({
    context,
    x: chipStartX,
    y: chipY,
    width: chipWidth,
    label: "Clean Depth",
    status: "ok"
  });
  drawMetricChip({
    context,
    x: chipStartX + chipWidth + chipGap,
    y: chipY,
    width: chipWidth,
    label: "Strong Drive",
    status: "ok"
  });
  drawMetricChip({
    context,
    x: chipStartX + (chipWidth + chipGap) * 2,
    y: chipY,
    width: chipWidth,
    label: "Confident Finish",
    status: "ok"
  });

  const panelY = canvasHeight * 0.78;
  context.fillStyle = "#f4f4ef";
  context.font = "800 28px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(titleText, 24, panelY + 12);

  context.fillStyle = "rgba(244, 244, 239, 0.48)";
  context.font = "300 28px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("done right.", 24, panelY + 44);

  context.fillStyle = "rgba(244, 244, 239, 0.78)";
  context.font = "600 14px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(
    "A strong squat set with clean depth, steady control, and a finish worth sharing.",
    24,
    panelY + 86,
    canvasWidth - 48
  );

  context.fillStyle = "rgba(244, 244, 239, 0.32)";
  context.font = "700 12px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("📍 Curefit (HQ) • 10th April", 24, panelY + 118);
}

function drawCultEidosOverlay(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  completedRepCount: number;
  titleText: string;
  subjectName: string;
}) {
  const { context, canvasWidth, canvasHeight, completedRepCount, titleText, subjectName } = params;
  drawStatusPill({
    context,
    x: 20,
    y: 18,
    width: 138,
    label: "LIFT STORY",
    accent: "#ef4d65"
  });
  drawStatusPill({
    context,
    x: canvasWidth - 132,
    y: 18,
    width: 112,
    label: `${completedRepCount} reps 🔥`,
    accent: "#f4f4ef",
    align: "right"
  });

  const chipY = canvasHeight * 0.68;
  const chipWidth = Math.min(148, canvasWidth * 0.28);
  const chipGap = 10;
  const chipStartX = 20;
  drawMetricChip({
    context,
    x: chipStartX,
    y: chipY,
    width: chipWidth,
    label: "Back Flat",
    status: "ok"
  });
  drawMetricChip({
    context,
    x: chipStartX + chipWidth + chipGap,
    y: chipY,
    width: chipWidth,
    label: "Hip Hinge",
    status: "locked"
  });
  drawMetricChip({
    context,
    x: chipStartX + (chipWidth + chipGap) * 2,
    y: chipY,
    width: chipWidth,
    label: "Lock Out",
    status: "locked"
  });

  const panelY = canvasHeight * 0.77;
  const fade = context.createLinearGradient(0, panelY - 80, 0, canvasHeight);
  fade.addColorStop(0, "rgba(4, 7, 11, 0)");
  fade.addColorStop(0.35, "rgba(4, 7, 11, 0.46)");
  fade.addColorStop(1, "rgba(4, 7, 11, 0.88)");
  context.fillStyle = fade;
  context.fillRect(0, panelY - 80, canvasWidth, canvasHeight - (panelY - 80));

  context.fillStyle = "#f4f4ef";
  context.font = "800 30px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(titleText, 24, panelY + 18);

  context.fillStyle = "rgba(244, 244, 239, 0.5)";
  context.font = "300 28px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("done clean.", 24, panelY + 50);

  context.fillStyle = "rgba(244, 244, 239, 0.76)";
  context.font = "600 14px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(
    `${subjectName} is holding a clean pattern. Keep the movement sharp and repeatable.`,
    24,
    panelY + 94
  );

  context.fillStyle = "rgba(244, 244, 239, 0.32)";
  context.font = "700 12px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("Cult Vision • Today", 24, canvasHeight - 18);
  context.textAlign = "right";
  context.fillText("@cultfit", canvasWidth - 24, canvasHeight - 18);
  context.textAlign = "left";
}

function drawSoftBorder(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  strokeStyle: string;
}) {
  const { context, canvasWidth, canvasHeight, strokeStyle } = params;
  drawRoundedRect(context, 14, 14, canvasWidth - 28, canvasHeight - 28, 24);
  context.strokeStyle = strokeStyle;
  context.lineWidth = 1.5;
  context.stroke();
}

function drawEditorialFooter(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  label: string;
  title: string;
  subtitle: string;
  body: string;
  accentColor: string;
}) {
  const { context, canvasWidth, canvasHeight, label, title, subtitle, body, accentColor } = params;
  const cardX = 22;
  const cardWidth = canvasWidth - 44;
  const cardHeight = 152;
  const cardY = canvasHeight - cardHeight - 22;

  drawRoundedRect(context, cardX, cardY, cardWidth, cardHeight, 26);
  context.fillStyle = "rgba(8, 11, 15, 0.78)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.lineWidth = 1.2;
  context.stroke();

  context.fillStyle = accentColor;
  context.fillRect(cardX + 18, cardY + 20, 4, 46);

  context.fillStyle = "rgba(244, 244, 239, 0.58)";
  context.font = "700 12px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(label.toUpperCase(), cardX + 32, cardY + 28);

  context.fillStyle = "#f4f4ef";
  context.font = "800 28px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(title, cardX + 32, cardY + 60);

  context.fillStyle = "rgba(244, 244, 239, 0.46)";
  context.font = "300 26px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(subtitle, cardX + 32, cardY + 92);

  context.fillStyle = "rgba(244, 244, 239, 0.72)";
  context.font = "600 14px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(body, cardX + 32, cardY + 124);
}

function drawTopRightCount(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  label: string;
  accentColor: string;
}) {
  const { context, canvasWidth, label, accentColor } = params;
  drawRoundedRect(context, canvasWidth - 140, 18, 118, 42, 20);
  context.fillStyle = "rgba(12, 15, 19, 0.82)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.08)";
  context.lineWidth = 1.2;
  context.stroke();
  context.fillStyle = accentColor;
  context.font = "800 15px 'Avenir Next', 'Segoe UI', sans-serif";
  context.textAlign = "center";
  context.fillText(label, canvasWidth - 81, 45);
  context.textAlign = "left";
}

function drawSideStatRail(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  totalReps: number;
  titleText: string;
  subjectName: string;
}) {
  const { context, canvasWidth, canvasHeight, totalReps, titleText, subjectName } = params;
  const railWidth = Math.min(164, canvasWidth * 0.3);
  const railX = canvasWidth - railWidth - 20;
  const railY = 70;
  const railHeight = canvasHeight - 160;

  drawRoundedRect(context, railX, railY, railWidth, railHeight, 26);
  context.fillStyle = "rgba(7, 12, 18, 0.68)";
  context.fill();
  context.strokeStyle = "rgba(112, 179, 255, 0.22)";
  context.lineWidth = 1.2;
  context.stroke();

  context.fillStyle = "rgba(112, 179, 255, 0.9)";
  context.font = "700 12px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText("COACH SLATE", railX + 18, railY + 28);

  context.fillStyle = "#f4f4ef";
  context.font = "800 40px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(String(totalReps), railX + 18, railY + 78);
  context.font = "700 13px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillStyle = "rgba(244, 244, 239, 0.6)";
  context.fillText("completed reps", railX + 18, railY + 100);

  context.fillStyle = "rgba(244, 244, 239, 0.84)";
  context.font = "700 15px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(titleText, railX + 18, railY + 150);
  context.fillStyle = "rgba(244, 244, 239, 0.56)";
  context.font = "600 13px 'Avenir Next', 'Segoe UI', sans-serif";
  context.fillText(subjectName, railX + 18, railY + 174);

  ["Tempo steady", "Setup composed", "Frame locked"].forEach((item, index) => {
    const y = railY + 220 + index * 44;
    drawRoundedRect(context, railX + 14, y, railWidth - 28, 32, 14);
    context.fillStyle = "rgba(255, 255, 255, 0.04)";
    context.fill();
    context.fillStyle = index === 1 ? "rgba(255, 219, 127, 0.86)" : "rgba(118, 228, 176, 0.9)";
    context.font = "700 12px 'Avenir Next', 'Segoe UI', sans-serif";
    context.fillText(item, railX + 26, y + 21);
  });
}

function drawRepAccentBubble(params: {
  context: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  strength: number;
}) {
  const { context, canvasWidth, canvasHeight, strength } = params;
  if (strength <= 0.01) {
    return;
  }

  const width = 92 + strength * 18;
  const height = 46 + strength * 6;
  const x = canvasWidth - width - 24;
  const y = canvasHeight * 0.22 - strength * 10;
  drawRoundedRect(context, x, y, width, height, 22);
  context.fillStyle = `rgba(210, 255, 114, ${0.9 * strength})`;
  context.fill();
  context.fillStyle = "#111315";
  context.font = "800 20px 'Avenir Next', 'Segoe UI', sans-serif";
  context.textAlign = "center";
  context.fillText("+1", x + width / 2, y + 30);
  context.textAlign = "left";
}

function drawFrameForTemplate(params: {
  templateId: VideoTemplateId;
  context: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  canvasWidth: number;
  canvasHeight: number;
  focusX: number;
  focusY: number;
  zoom: number;
  activeRepBubbleStrength: number;
  completedRepCount: number;
  titleText: string;
  subjectName: string;
  primaryLogoImage: CanvasImageSource | null;
  primaryRepPulseStrength: number;
}) {
  const crop = drawBaseVideoFrame(params);

  if (params.templateId === "cult-eidos") {
    params.context.save();
    params.context.globalAlpha = 0.08;
    params.context.filter = "contrast(1.15) saturate(0.85) blur(2px)";
    params.context.drawImage(
      params.video,
      crop.cropX,
      crop.cropY,
      crop.cropWidth,
      crop.cropHeight,
      0,
      0,
      params.canvasWidth,
      params.canvasHeight
    );
    params.context.restore();

    const glaze = params.context.createLinearGradient(0, 0, 0, params.canvasHeight);
    glaze.addColorStop(0, "rgba(6, 9, 12, 0.18)");
    glaze.addColorStop(0.55, "rgba(6, 9, 12, 0.04)");
    glaze.addColorStop(1, "rgba(3, 5, 8, 0.56)");
    params.context.fillStyle = glaze;
    params.context.fillRect(0, 0, params.canvasWidth, params.canvasHeight);

    drawCultEidosOverlay({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      completedRepCount: params.completedRepCount,
      titleText: params.titleText,
      subjectName: params.subjectName
    });
    return;
  }

  if (isPrimaryTemplateId(params.templateId)) {
    const cleanWash = params.context.createLinearGradient(0, 0, 0, params.canvasHeight);
    cleanWash.addColorStop(0, "rgba(210, 255, 114, 0.08)");
    cleanWash.addColorStop(0.52, "rgba(8, 10, 12, 0.08)");
    cleanWash.addColorStop(1, "rgba(5, 8, 11, 0.28)");
    params.context.fillStyle = cleanWash;
    params.context.fillRect(0, 0, params.canvasWidth, params.canvasHeight);
    drawSoftBorder({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      strokeStyle: "rgba(210, 255, 114, 0.18)"
    });
    drawPrimaryOverlay({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      completedRepCount: params.completedRepCount,
      titleText: params.titleText,
      subjectName: params.subjectName,
      logoImage: params.primaryLogoImage,
      repPulseStrength: params.primaryRepPulseStrength
    });
    return;
  }

  if (params.templateId === "depth-drive") {
    const warmWash = params.context.createLinearGradient(
      0,
      0,
      0,
      params.canvasHeight
    );
    warmWash.addColorStop(0, "rgba(91, 58, 24, 0.18)");
    warmWash.addColorStop(1, "rgba(10, 8, 7, 0.42)");
    params.context.fillStyle = warmWash;
    params.context.fillRect(0, 0, params.canvasWidth, params.canvasHeight);
    drawSoftBorder({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      strokeStyle: "rgba(255, 198, 132, 0.24)"
    });
    drawTopRightCount({
      context: params.context,
      canvasWidth: params.canvasWidth,
      label: `${params.completedRepCount} reps`,
      accentColor: "#ffc684"
    });
    drawEditorialFooter({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      label: "Amber Frame",
      title: params.titleText,
      subtitle: "warmed up.",
      body: `${params.subjectName} in a softer cinematic cut with a warm strength finish.`,
      accentColor: "#ffc684"
    });
    return;
  }

  if (params.templateId === "iron-echo") {
    params.context.save();
    params.context.filter = "grayscale(1) contrast(1.36) brightness(0.96)";
    params.context.drawImage(
      params.video,
      crop.cropX,
      crop.cropY,
      crop.cropWidth,
      crop.cropHeight,
      0,
      0,
      params.canvasWidth,
      params.canvasHeight
    );
    params.context.restore();

    drawSoftBorder({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      strokeStyle: "rgba(244, 244, 239, 0.22)"
    });
    drawEditorialFooter({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      label: "Noir Motion",
      title: params.titleText,
      subtitle: "in monochrome.",
      body: `${params.subjectName} in a cleaner black-and-white studio treatment.`,
      accentColor: "#f4f4ef"
    });
    return;
  }

  if (params.templateId === "arena-lift") {
    const coolWash = params.context.createLinearGradient(
      0,
      0,
      params.canvasWidth,
      params.canvasHeight
    );
    coolWash.addColorStop(0, "rgba(45, 87, 138, 0.08)");
    coolWash.addColorStop(1, "rgba(7, 12, 18, 0.38)");
    params.context.fillStyle = coolWash;
    params.context.fillRect(0, 0, params.canvasWidth, params.canvasHeight);
    drawSideStatRail({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      totalReps: params.completedRepCount,
      titleText: params.titleText,
      subjectName: params.subjectName
    });
    drawEditorialFooter({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      label: "Coach Slate",
      title: params.titleText,
      subtitle: "performance ready.",
      body: "A cleaner coaching layout with stats that sit beside the action, not over it.",
      accentColor: "#7bb6ff"
    });
    return;
  }

  if (params.templateId === "rep-bingo") {
    drawTopRightCount({
      context: params.context,
      canvasWidth: params.canvasWidth,
      label: `${params.completedRepCount} reps`,
      accentColor: "#d2ff72"
    });
    drawRepAccentBubble({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      strength: params.activeRepBubbleStrength
    });
    drawEditorialFooter({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      label: "Rep Marks",
      title: params.titleText,
      subtitle: "rep accents synced.",
      body: "Minimal cues, subtle rep pops, and a cleaner performance finish.",
      accentColor: "#d2ff72"
    });
    return;
  }

  const cleanWash = params.context.createLinearGradient(0, 0, 0, params.canvasHeight);
  cleanWash.addColorStop(0, "rgba(210, 255, 114, 0.08)");
  cleanWash.addColorStop(1, "rgba(8, 10, 12, 0.34)");
  params.context.fillStyle = cleanWash;
  params.context.fillRect(0, 0, params.canvasWidth, params.canvasHeight);
  drawSoftBorder({
    context: params.context,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    strokeStyle: "rgba(210, 255, 114, 0.18)"
  });
  drawTopRightCount({
    context: params.context,
    canvasWidth: params.canvasWidth,
    label: `${params.completedRepCount} reps`,
    accentColor: "#d2ff72"
  });
  drawEditorialFooter({
    context: params.context,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
    label: "Clean Strength",
    title: params.titleText,
    subtitle: "captured clean.",
    body: `${params.subjectName} in a minimal export with sharper framing and softer overlays.`,
    accentColor: "#d2ff72"
  });
}

function buildRepMoments(params: {
  repEvents?: RecordingRepEvent[];
  repCount?: number;
  sourceDurationSec: number;
}): number[] {
  const repEvents = params.repEvents ?? [];

  if (repEvents.length > 0) {
    const exactMoments = repEvents
      .map((event) => event.timestampMs / 1000)
      .filter((timeSec) => timeSec >= 0 && timeSec <= params.sourceDurationSec + 0.1)
      .sort((left, right) => left - right);

    if (exactMoments.length > 0) {
      return exactMoments;
    }
  }

  const repCount = params.repCount ?? 0;
  if (repCount <= 0 || params.sourceDurationSec <= 0) {
    return [];
  }

  const leadIn = Math.min(1.1, params.sourceDurationSec * 0.16);
  const tail = Math.min(0.7, params.sourceDurationSec * 0.12);
  const usableWindow = Math.max(0.8, params.sourceDurationSec - leadIn - tail);
  const interval = usableWindow / repCount;

  return Array.from({ length: repCount }, (_, index) =>
    clamp(leadIn + interval * (index + 0.72), 0.3, params.sourceDurationSec)
  );
}

function getTemplateBaseZoom(templateId: VideoTemplateId): number {
  switch (templateId) {
    case "primary":
    case "primary-dhurandhar":
      return 1.06;
    case "cult-eidos":
      return 1.06;
    case "gym-highlight":
      return 1.08;
    case "depth-drive":
      return 1.12;
    case "iron-echo":
      return 1.16;
    case "arena-lift":
      return 1.1;
    default:
      return 1.04;
  }
}

function getTemplateFaceZoom(templateId: VideoTemplateId): number {
  switch (templateId) {
    case "primary":
    case "primary-dhurandhar":
      return 1.12;
    case "cult-eidos":
      return 1.1;
    case "gym-highlight":
      return 1.22;
    case "depth-drive":
      return 1.16;
    case "iron-echo":
      return 1.24;
    case "arena-lift":
      return 1.18;
    default:
      return 1.1;
  }
}

function getTemplateFallbackZoom(templateId: VideoTemplateId): number {
  switch (templateId) {
    case "primary":
    case "primary-dhurandhar":
      return 1.08;
    case "cult-eidos":
      return 1.08;
    case "gym-highlight":
      return 1.1;
    case "depth-drive":
      return 1.14;
    case "iron-echo":
      return 1.2;
    case "arena-lift":
      return 1.12;
    default:
      return 1.05;
  }
}

function scheduleRepChime(
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  scheduledAt: number
) {
  const gain = audioContext.createGain();
  const tone = audioContext.createOscillator();
  const sparkle = audioContext.createOscillator();

  gain.gain.setValueAtTime(0.0001, scheduledAt);
  gain.gain.exponentialRampToValueAtTime(0.17, scheduledAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, scheduledAt + 0.3);
  gain.connect(destination);

  tone.type = "triangle";
  tone.frequency.setValueAtTime(880, scheduledAt);
  tone.frequency.exponentialRampToValueAtTime(1174, scheduledAt + 0.18);
  tone.connect(gain);

  sparkle.type = "sine";
  sparkle.frequency.setValueAtTime(1318, scheduledAt + 0.02);
  sparkle.frequency.exponentialRampToValueAtTime(1567, scheduledAt + 0.18);
  sparkle.connect(gain);

  tone.start(scheduledAt);
  sparkle.start(scheduledAt + 0.02);
  tone.stop(scheduledAt + 0.3);
  sparkle.stop(scheduledAt + 0.24);

  sparkle.onended = () => {
    tone.disconnect();
    sparkle.disconnect();
    gain.disconnect();
  };
}

export function getVideoTemplates(): VideoTemplateDefinition[] {
  return TEMPLATE_DEFINITIONS;
}

function getTemplateRenderWindow(params: {
  templateId: VideoTemplateId;
  durationSec: number;
  repMomentsSec: number[];
}) {
  const { templateId, durationSec, repMomentsSec } = params;

  if (!isPrimaryTemplateId(templateId) || repMomentsSec.length === 0 || durationSec <= 0) {
    return {
      startSec: 0,
      endSec: durationSec,
      durationSec: Math.max(durationSec, 0)
    };
  }

  const firstRepSec = repMomentsSec[0];
  const lastRepSec = repMomentsSec[repMomentsSec.length - 1];
  const startSec = clamp(firstRepSec - 1, 0, durationSec);
  const endSec = clamp(lastRepSec + 1, startSec + 0.2, durationSec);

  return {
    startSec,
    endSec,
    durationSec: Math.max(0.2, endSec - startSec)
  };
}

function getPrimarySlowMotionWindow(params: {
  templateId: VideoTemplateId;
  repMomentsSec: number[];
  renderWindow: { startSec: number; endSec: number };
  durationSec: number;
}) {
  const { templateId, repMomentsSec, renderWindow, durationSec } = params;

  if (!isPrimaryTemplateId(templateId) || repMomentsSec.length === 0 || durationSec <= 0) {
    return null;
  }

  const lastRepSec = repMomentsSec[repMomentsSec.length - 1];
  const previousRepSec =
    repMomentsSec.length > 1 ? repMomentsSec[repMomentsSec.length - 2] : null;
  const inferredRepDurationSec = clamp(
    previousRepSec !== null ? lastRepSec - previousRepSec : renderWindow.endSec - renderWindow.startSec,
    1.1,
    3.1
  );
  const slowStartSec = clamp(
    lastRepSec - inferredRepDurationSec * 0.86,
    renderWindow.startSec,
    renderWindow.endSec
  );
  const slowEndSec = clamp(
    lastRepSec + Math.max(0.16, inferredRepDurationSec * 0.16),
    slowStartSec + 0.28,
    renderWindow.endSec
  );

  return {
    startSec: slowStartSec,
    endSec: slowEndSec,
    playbackRate: 0.42
  };
}

function getPrimaryMotionState(params: {
  templateId: VideoTemplateId;
  renderCurrentTimeSec: number;
  renderWindow: { startSec: number; endSec: number; durationSec: number };
  slowMotionWindow: { startSec: number; endSec: number; playbackRate: number } | null;
}) {
  if (!isPrimaryTemplateId(params.templateId)) {
    return {
      smoothedZoomOffset: 0,
      heroFocusBlend: 0,
      predictedFocusYOffset: 0
    };
  }

  const clampedTimeSec = clamp(
    params.renderCurrentTimeSec,
    params.renderWindow.startSec,
    params.renderWindow.endSec
  );
  const setProgress =
    params.renderWindow.durationSec > 0
      ? clamp(
          (clampedTimeSec - params.renderWindow.startSec) / params.renderWindow.durationSec,
          0,
          1
        )
      : 0;
  const pushInZoom = lerp(0, 0.14, easeInOutQuad(setProgress));

  let heroRepZoom = 0;
  let heroFocusBlend = 0;
  let predictedFocusYOffset = 0;
  if (params.slowMotionWindow) {
    const rampInStartSec = Math.max(
      params.renderWindow.startSec,
      params.slowMotionWindow.startSec - 0.28
    );
    const rampOutEndSec = Math.min(
      params.renderWindow.endSec,
      params.slowMotionWindow.endSec + 0.18
    );
    const heroEnvelope = getRampEnvelope(
      clampedTimeSec,
      rampInStartSec,
      params.slowMotionWindow.startSec,
      params.slowMotionWindow.endSec,
      rampOutEndSec
    );

    heroRepZoom = 0.18 * heroEnvelope;
    heroFocusBlend = heroEnvelope;

    const heroProgress = clamp(
      (clampedTimeSec - params.slowMotionWindow.startSec) /
        Math.max(0.001, params.slowMotionWindow.endSec - params.slowMotionWindow.startSec),
      0,
      1
    );
    const bottomPhaseProgress =
      heroProgress <= 0.58
        ? easeInOutQuad(heroProgress / 0.58)
        : 1 - easeInOutQuad((heroProgress - 0.58) / 0.42);
    predictedFocusYOffset = 0.16 * bottomPhaseProgress * heroEnvelope;
  }

  return {
    smoothedZoomOffset: pushInZoom + heroRepZoom,
    heroFocusBlend,
    predictedFocusYOffset
  };
}

export async function renderVideoTemplate(params: {
  sourceUrl: string;
  templateId: VideoTemplateId;
  repEvents?: RecordingRepEvent[];
  repCount?: number;
  durationSec?: number;
  titleText?: string;
  subjectName?: string;
  onProgress?: (progress: TemplateRenderProgress) => void;
}): Promise<TemplateRenderResult> {
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("Video templates are only available in a browser that supports recording.");
  }

  const template = getTemplateDefinition(params.templateId);
  const mimeType = getSupportedRenderMimeType();
  const sourceVideo = createHiddenVideo(params.sourceUrl);
  const faceDetector = params.templateId === "gym-highlight" ? createFaceDetector() : null;

  await waitForEvent(sourceVideo, "loadedmetadata");

  const durationSec =
    Number.isFinite(sourceVideo.duration) && sourceVideo.duration > 0
      ? sourceVideo.duration
      : params.durationSec ?? 0;
  const repMomentsSec = buildRepMoments({
    repEvents: params.repEvents,
    repCount: params.repCount,
    sourceDurationSec: durationSec
  });
  const renderWindow = getTemplateRenderWindow({
    templateId: params.templateId,
    durationSec,
    repMomentsSec
  });
  const slowMotionWindow = getPrimarySlowMotionWindow({
    templateId: params.templateId,
    repMomentsSec,
    renderWindow,
    durationSec
  });

  if (template.requiresRepTiming && repMomentsSec.length === 0) {
    throw new Error("Wait for analysis to finish so this template can sync the +1 pop to each rep.");
  }

  const outputSize = getOutputSize(sourceVideo.videoWidth || 720, sourceVideo.videoHeight || 1280);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize.width;
  canvas.height = outputSize.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create the video template canvas.");
  }

  const canvasStream = canvas.captureStream(24);
  const needsAudioTrack =
    params.templateId === "rep-bingo" || isPrimaryTemplateId(params.templateId);
  const audioContext = needsAudioTrack ? new AudioContext() : null;
  const loadPrimaryTrackBuffer =
    audioContext && isPrimaryTemplateId(params.templateId)
      ? createAudioBufferLoader(audioContext, getPrimaryTrackSourceUrl(params.templateId))
      : null;
  const audioDestination = audioContext?.createMediaStreamDestination() ?? null;
  const outputStream =
    audioDestination !== null
      ? new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioDestination.stream.getAudioTracks()
        ])
      : canvasStream;
  const recorder = new MediaRecorder(outputStream, { mimeType });
  const chunks: BlobPart[] = [];
  let animationFrameId: number | null = null;
  let detectionInFlight = false;
  let lastDetectionAt = 0;
  let detectedFaceFocusX: number | null = null;
  let detectedFaceFocusY: number | null = null;
  let targetFocusX = 0.5;
  let targetFocusY = 0.38;
  let targetZoom = getTemplateBaseZoom(params.templateId);
  let focusX = 0.5;
  let focusY = 0.38;
  let zoom = targetZoom;
  let nextRepMomentIndex = 0;
  let completedRepCount = 0;
  let lastRepTriggerTimeSec = -99;
  let didFinalize = false;
  let activePrimaryTrackSource: AudioBufferSourceNode | null = null;
  let primaryTrackBuffer: AudioBuffer | null = null;
  let primaryLogoImage: HTMLImageElement | null = null;
  const titleText = params.titleText ?? "Strength Session";
  const subjectName = params.subjectName ?? "Cult Vision";

  const cleanup = () => {
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
    }

    outputStream.getTracks().forEach((track) => track.stop());
    canvasStream.getTracks().forEach((track) => track.stop());
    sourceVideo.pause();
    sourceVideo.src = "";
    if (activePrimaryTrackSource) {
      try {
        activePrimaryTrackSource.stop();
      } catch {
        // Ignore cleanup issues for already-ended nodes.
      }
      activePrimaryTrackSource.disconnect();
      activePrimaryTrackSource = null;
    }
    if (audioContext) {
      void audioContext.close();
    }
  };

  const finalizeRender = () => {
    if (didFinalize) {
      return;
    }

    didFinalize = true;
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    params.onProgress?.({
      progress: 0.99,
      message: "Wrapping up the edited export..."
    });

    sourceVideo.pause();
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  const maybeDetectFace = () => {
    if (!faceDetector || detectionInFlight) {
      return;
    }

    const now = performance.now();
    if (now - lastDetectionAt < 420) {
      return;
    }

    lastDetectionAt = now;
    detectionInFlight = true;

    void faceDetector
      .detect(sourceVideo)
      .then((faces) => {
        const firstFace = faces[0]?.boundingBox;
        if (!firstFace || sourceVideo.videoWidth === 0 || sourceVideo.videoHeight === 0) {
          detectedFaceFocusX = null;
          detectedFaceFocusY = null;
          if (isPrimaryTemplateId(params.templateId)) {
            return;
          }
          targetFocusX = 0.5;
          targetFocusY = params.templateId === "depth-drive" ? 0.48 : 0.4;
          targetZoom = getTemplateFallbackZoom(params.templateId);
          return;
        }

        const nextFaceFocusX = clamp(
          (firstFace.x + firstFace.width / 2) / sourceVideo.videoWidth,
          0.28,
          0.72
        );
        const nextFaceFocusY = clamp(
          (firstFace.y + firstFace.height * 1.4) / sourceVideo.videoHeight,
          params.templateId === "depth-drive" ? 0.28 : 0.2,
          params.templateId === "depth-drive" ? 0.78 : 0.7
        );
        detectedFaceFocusX = nextFaceFocusX;
        detectedFaceFocusY = nextFaceFocusY;
        if (isPrimaryTemplateId(params.templateId)) {
          return;
        }
        targetFocusX = nextFaceFocusX;
        targetFocusY = nextFaceFocusY;
        targetZoom = getTemplateFaceZoom(params.templateId);
      })
      .catch(() => {
        detectedFaceFocusX = null;
        detectedFaceFocusY = null;
        if (isPrimaryTemplateId(params.templateId)) {
          return;
        }
        targetFocusX = 0.5;
        targetFocusY = params.templateId === "depth-drive" ? 0.48 : 0.4;
        targetZoom = getTemplateFallbackZoom(params.templateId);
      })
      .finally(() => {
        detectionInFlight = false;
      });
  };

  const blobPromise = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      reject(new Error("The edited clip could not be rendered."));
    };

    recorder.onstop = () => {
      resolve(
        new Blob(chunks, {
          type: recorder.mimeType || mimeType
        })
      );
    };
  });

  const renderLoop = () => {
    if (didFinalize) {
      return;
    }

    maybeDetectFace();

    const currentSourceTimeSec = sourceVideo.currentTime;
    const primaryMotionState = getPrimaryMotionState({
      templateId: params.templateId,
      renderCurrentTimeSec: currentSourceTimeSec,
      renderWindow,
      slowMotionWindow
    });
    if (isPrimaryTemplateId(params.templateId)) {
      const hasDetectedFace = detectedFaceFocusX !== null && detectedFaceFocusY !== null;
      const heroSubjectFocusX = hasDetectedFace ? detectedFaceFocusX ?? 0.5 : 0.5;
      const estimatedHeroFocusY = clamp(
        0.38 + primaryMotionState.predictedFocusYOffset,
        0.28,
        0.62
      );
      const heroSubjectFocusY = hasDetectedFace
        ? clamp(
            (detectedFaceFocusY ?? estimatedHeroFocusY) +
              primaryMotionState.predictedFocusYOffset * 0.34,
            0.22,
            0.7
          )
        : estimatedHeroFocusY;
      const followBlend = hasDetectedFace
        ? clamp(0.2 + primaryMotionState.heroFocusBlend * 0.8, 0, 1)
        : primaryMotionState.heroFocusBlend;
      targetFocusX = lerp(0.5, heroSubjectFocusX, followBlend);
      targetFocusY = lerp(0.38, heroSubjectFocusY, followBlend);
      targetZoom = getTemplateBaseZoom(params.templateId) + primaryMotionState.smoothedZoomOffset;
    }

    focusX += (targetFocusX - focusX) * 0.12;
    focusY += (targetFocusY - focusY) * 0.12;
    zoom += (targetZoom - zoom) * 0.08;

    const renderCurrentTimeSec = clamp(
      currentSourceTimeSec,
      renderWindow.startSec,
      renderWindow.endSec
    );
    const activePlaybackRate =
      slowMotionWindow &&
      renderCurrentTimeSec >= slowMotionWindow.startSec &&
      renderCurrentTimeSec <= slowMotionWindow.endSec
        ? slowMotionWindow.playbackRate
        : 1;

    if (Math.abs(sourceVideo.playbackRate - activePlaybackRate) > 0.01) {
      sourceVideo.playbackRate = activePlaybackRate;
    }

    while (
      nextRepMomentIndex < repMomentsSec.length &&
      renderCurrentTimeSec >= repMomentsSec[nextRepMomentIndex]
    ) {
      lastRepTriggerTimeSec = repMomentsSec[nextRepMomentIndex];
      completedRepCount = nextRepMomentIndex + 1;
      nextRepMomentIndex += 1;
    }

    const bubbleAgeSec = renderCurrentTimeSec - lastRepTriggerTimeSec;
    const activeRepBubbleStrength =
      params.templateId === "rep-bingo" && bubbleAgeSec >= 0 && bubbleAgeSec <= 0.62
        ? 1 - bubbleAgeSec / 0.62
        : 0;
    const activePrimaryRepPulseStrength =
      isPrimaryTemplateId(params.templateId) && bubbleAgeSec >= 0 && bubbleAgeSec <= 0.32
        ? 1 - bubbleAgeSec / 0.32
        : 0;

    drawFrameForTemplate({
      templateId: params.templateId,
      context,
      video: sourceVideo,
      canvasWidth: outputSize.width,
      canvasHeight: outputSize.height,
      focusX,
      focusY,
      zoom,
      activeRepBubbleStrength,
      completedRepCount,
      titleText,
      subjectName,
      primaryLogoImage,
      primaryRepPulseStrength: activePrimaryRepPulseStrength
    });

    const progressRatio =
      renderWindow.durationSec > 0
        ? clamp((renderCurrentTimeSec - renderWindow.startSec) / renderWindow.durationSec, 0, 0.98)
        : 0.4;
    params.onProgress?.({
      progress: progressRatio,
      message: (() => {
        if (isPrimaryTemplateId(params.templateId)) {
          return progressRatio < 0.2
            ? "Preparing the Primary template..."
            : progressRatio < 0.84
              ? "Rendering the Primary template..."
              : "Finishing the Primary export...";
        }
        if (params.templateId === "rep-bingo") {
          return progressRatio < 0.22
            ? "Lining up subtle rep accents..."
            : progressRatio < 0.84
              ? "Rendering soft rep cues and clean markers..."
              : "Finalizing your rep-accent edit...";
        }
        if (params.templateId === "cult-eidos") {
          return progressRatio < 0.22
            ? "Building the story-led coaching frame..."
            : progressRatio < 0.84
              ? "Rendering the premium editorial overlay..."
              : "Finishing the Lift Story cut...";
        }
        if (params.templateId === "depth-drive") {
          return progressRatio < 0.22
            ? "Building the warm cinematic grade..."
            : progressRatio < 0.84
              ? "Rendering the amber editorial finish..."
              : "Locking in the final amber cut...";
        }
        if (params.templateId === "iron-echo") {
          return progressRatio < 0.22
            ? "Dialing in the noir contrast..."
            : progressRatio < 0.84
              ? "Rendering the monochrome studio pass..."
              : "Finishing the noir motion pass...";
        }
        if (params.templateId === "arena-lift") {
          return progressRatio < 0.22
            ? "Setting up the coaching rail layout..."
            : progressRatio < 0.84
              ? "Rendering the stat rail and clean footer..."
              : "Wrapping the coach slate edit...";
        }
        return progressRatio < 0.18
          ? "Applying the clean premium grade..."
          : progressRatio < 0.82
            ? "Rendering the minimal clean-strength finish..."
            : "Finalizing your edited video...";
      })()
    });

    if (renderCurrentTimeSec >= renderWindow.endSec - 1 / 30) {
      finalizeRender();
      return;
    }

    if (!sourceVideo.paused && !sourceVideo.ended) {
      animationFrameId = window.requestAnimationFrame(renderLoop);
      return;
    }

    finalizeRender();
  };

  params.onProgress?.({
    progress: 0.04,
    message:
      isPrimaryTemplateId(params.templateId)
        ? "Preparing the Primary template..."
        : params.templateId === "rep-bingo"
        ? "Preparing the rep-accent template..."
        : params.templateId === "cult-eidos"
          ? "Preparing the Lift Story template..."
        : params.templateId === "depth-drive"
          ? "Preparing the Amber Frame template..."
          : params.templateId === "iron-echo"
            ? "Preparing the Noir Motion template..."
            : params.templateId === "arena-lift"
              ? "Preparing the Coach Slate template..."
              : "Preparing the Clean Strength template..."
  });

  if (isPrimaryTemplateId(params.templateId) && loadPrimaryTrackBuffer) {
    try {
      primaryTrackBuffer = await loadPrimaryTrackBuffer();
    } catch {
      cleanup();
      throw new Error("Could not load the soundtrack for the Primary template.");
    }
  }

  if (isPrimaryTemplateId(params.templateId)) {
    try {
      primaryLogoImage = await loadCultLogoImage();
    } catch {
      cleanup();
      throw new Error("Could not load the Cult logo for the Primary template.");
    }
  }

  try {
    if (renderWindow.startSec > 0.01) {
      await seekVideo(sourceVideo, renderWindow.startSec);
    }
  } catch {
    cleanup();
    throw new Error("The source video could not start playing for template rendering.");
  }

  recorder.start(400);
  try {
    if (audioContext) {
      await audioContext.resume();
    }
  } catch {
    // The generated export can still proceed without audible monitor output.
  }

  try {
    await sourceVideo.play();
  } catch {
    cleanup();
    throw new Error("The source video could not start playing for template rendering.");
  }

  if (
    isPrimaryTemplateId(params.templateId) &&
    audioContext &&
    audioDestination &&
    primaryTrackBuffer
  ) {
    const primaryTrackSource = audioContext.createBufferSource();
    const primaryTrackGain = audioContext.createGain();

    primaryTrackSource.buffer = primaryTrackBuffer;
    primaryTrackGain.gain.value = 0.9;
    primaryTrackSource.connect(primaryTrackGain);
    primaryTrackGain.connect(audioDestination);
    primaryTrackSource.start(audioContext.currentTime + 0.02, 0);
    primaryTrackSource.onended = () => {
      primaryTrackSource.disconnect();
      primaryTrackGain.disconnect();
    };
    activePrimaryTrackSource = primaryTrackSource;
  }

  if (params.templateId === "rep-bingo" && repMomentsSec.length > 0 && audioContext && audioDestination) {
    const playbackStartAudioTime = audioContext.currentTime;
    repMomentsSec.forEach((repMomentSec) => {
      scheduleRepChime(
        audioContext,
        audioDestination,
        playbackStartAudioTime + Math.max(0, repMomentSec - renderWindow.startSec)
      );
    });
  }

  renderLoop();
  if (renderWindow.endSec >= durationSec - 0.04) {
    sourceVideo.addEventListener("ended", finalizeRender, { once: true });
  }
  const blob = await blobPromise;
  cleanup();

  params.onProgress?.({
    progress: 1,
    message: "Edited video ready."
  });

  return {
    blob,
    mimeType: blob.type || mimeType,
    templateId: template.id,
    templateName: template.name
  };
}
