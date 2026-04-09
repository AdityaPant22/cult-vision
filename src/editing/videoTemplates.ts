import { RecordingRepEvent, VideoTemplateId } from "../types";

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

const TEMPLATE_DEFINITIONS: VideoTemplateDefinition[] = [
  {
    id: "gym-highlight",
    name: "Gym Highlight",
    shortLabel: "Punchy zoom edit",
    description:
      "Adds a cinematic crop, a face-aware punch-in when available, higher contrast, and a stronger gym-grade look.",
    effects: ["Face punch-in", "Crisp contrast", "Subtle vignette", "Highlight finish"]
  },
  {
    id: "rep-bingo",
    name: "Rep Bingo",
    shortLabel: "Synced +1 rep pops",
    description:
      "Adds a +1 bubble and a celebratory bingo chime each time a rep completes, using backend rep timing when it is available.",
    effects: ["Rep-synced +1 bubble", "Bingo sound", "Live rep total", "Energetic overlay"],
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getTemplateDefinition(templateId: VideoTemplateId): VideoTemplateDefinition {
  return TEMPLATE_DEFINITIONS.find((template) => template.id === templateId) ?? TEMPLATE_DEFINITIONS[0];
}

function getSupportedRenderMimeType(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

  const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!mimeType) {
    throw new Error("This browser cannot export edited video templates yet.");
  }

  return mimeType;
}

function getOutputSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const scale = longestSide > 960 ? 960 / longestSide : 1;

  return {
    width: Math.max(360, Math.round(sourceWidth * scale)),
    height: Math.max(360, Math.round(sourceHeight * scale))
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
  const sourceWidth = video.videoWidth || canvasWidth;
  const sourceHeight = video.videoHeight || canvasHeight;
  const cropWidth = sourceWidth / zoom;
  const cropHeight = sourceHeight / zoom;
  const cropX = clamp(sourceWidth * focusX - cropWidth / 2, 0, sourceWidth - cropWidth);
  const cropY = clamp(sourceHeight * focusY - cropHeight / 2, 0, sourceHeight - cropHeight);

  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.filter = "contrast(1.18) saturate(1.18) brightness(1.05)";
  context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, canvasWidth, canvasHeight);

  context.globalAlpha = 0.14;
  context.filter = "contrast(1.32) saturate(1.08)";
  context.drawImage(
    video,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
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
}) {
  drawBaseVideoFrame(params);

  if (params.templateId === "rep-bingo") {
    drawCornerBadge({
      context: params.context,
      canvasWidth: params.canvasWidth,
      label: "REP BINGO",
      subtitle: "Synced rep pops"
    });
    drawRepBubble({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      strength: params.activeRepBubbleStrength,
      bubbleText: "+1"
    });
    drawRepScoreboard({
      context: params.context,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      totalReps: params.completedRepCount
    });
    return;
  }

  drawCornerBadge({
    context: params.context,
    canvasWidth: params.canvasWidth,
    label: "GYM HIGHLIGHT",
    subtitle: "Punchy edit applied"
  });
}

function buildRepMoments(params: {
  repEvents?: RecordingRepEvent[];
  repCount?: number;
  sourceDurationSec: number;
}): number[] {
  const repEvents = params.repEvents ?? [];

  if (repEvents.length > 0) {
    return repEvents
      .map((event) => event.timestampMs / 1000)
      .filter((timeSec) => timeSec >= 0 && timeSec <= params.sourceDurationSec + 0.1)
      .sort((left, right) => left - right);
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

export async function renderVideoTemplate(params: {
  sourceUrl: string;
  templateId: VideoTemplateId;
  repEvents?: RecordingRepEvent[];
  repCount?: number;
  durationSec?: number;
  onProgress?: (progress: TemplateRenderProgress) => void;
}): Promise<TemplateRenderResult> {
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("Video templates are only available in a browser that supports recording.");
  }

  const template = getTemplateDefinition(params.templateId);
  const mimeType = getSupportedRenderMimeType();
  const sourceVideo = createHiddenVideo(params.sourceUrl);
  const faceDetector = createFaceDetector();

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

  const canvasStream = canvas.captureStream(30);
  const audioContext = new AudioContext();
  const audioDestination = audioContext.createMediaStreamDestination();
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioDestination.stream.getAudioTracks()
  ]);
  const recorder = new MediaRecorder(combinedStream, { mimeType });
  const chunks: BlobPart[] = [];
  let animationFrameId: number | null = null;
  let detectionInFlight = false;
  let lastDetectionAt = 0;
  let targetFocusX = 0.5;
  let targetFocusY = 0.38;
  let targetZoom = params.templateId === "gym-highlight" ? 1.08 : 1.04;
  let focusX = 0.5;
  let focusY = 0.38;
  let zoom = targetZoom;
  let nextRepMomentIndex = 0;
  let completedRepCount = 0;
  let lastRepTriggerTimeSec = -99;

  const cleanup = () => {
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
    }

    combinedStream.getTracks().forEach((track) => track.stop());
    canvasStream.getTracks().forEach((track) => track.stop());
    sourceVideo.pause();
    sourceVideo.src = "";
    void audioContext.close();
  };

  const maybeDetectFace = () => {
    if (!faceDetector || detectionInFlight) {
      return;
    }

    const now = performance.now();
    if (now - lastDetectionAt < 260) {
      return;
    }

    lastDetectionAt = now;
    detectionInFlight = true;

    void faceDetector
      .detect(sourceVideo)
      .then((faces) => {
        const firstFace = faces[0]?.boundingBox;
        if (!firstFace || sourceVideo.videoWidth === 0 || sourceVideo.videoHeight === 0) {
          targetFocusX = 0.5;
          targetFocusY = 0.4;
          targetZoom = params.templateId === "gym-highlight" ? 1.1 : 1.05;
          return;
        }

        targetFocusX = clamp(
          (firstFace.x + firstFace.width / 2) / sourceVideo.videoWidth,
          0.28,
          0.72
        );
        targetFocusY = clamp(
          (firstFace.y + firstFace.height * 1.4) / sourceVideo.videoHeight,
          0.2,
          0.7
        );
        targetZoom = params.templateId === "gym-highlight" ? 1.22 : 1.1;
      })
      .catch(() => {
        targetFocusX = 0.5;
        targetFocusY = 0.4;
        targetZoom = params.templateId === "gym-highlight" ? 1.1 : 1.05;
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
    maybeDetectFace();
    focusX += (targetFocusX - focusX) * 0.12;
    focusY += (targetFocusY - focusY) * 0.12;
    zoom += (targetZoom - zoom) * 0.08;

    while (
      nextRepMomentIndex < repMomentsSec.length &&
      sourceVideo.currentTime >= repMomentsSec[nextRepMomentIndex]
    ) {
      lastRepTriggerTimeSec = repMomentsSec[nextRepMomentIndex];
      completedRepCount = nextRepMomentIndex + 1;
      nextRepMomentIndex += 1;
    }

    const bubbleAgeSec = sourceVideo.currentTime - lastRepTriggerTimeSec;
    const activeRepBubbleStrength =
      params.templateId === "rep-bingo" && bubbleAgeSec >= 0 && bubbleAgeSec <= 0.62
        ? 1 - bubbleAgeSec / 0.62
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
      completedRepCount
    });

    const progressRatio =
      durationSec > 0 ? clamp(sourceVideo.currentTime / durationSec, 0, 0.98) : 0.4;
    params.onProgress?.({
      progress: progressRatio,
      message:
        params.templateId === "rep-bingo"
          ? progressRatio < 0.22
            ? "Lining up rep timing and overlay..."
            : progressRatio < 0.84
              ? "Rendering synced +1 pops and bingo sound..."
              : "Finalizing your rep edit..."
          : progressRatio < 0.18
            ? "Applying the gym color grade..."
            : progressRatio < 0.82
              ? "Rendering zoom and sharpen look..."
              : "Finalizing your edited video..."
    });

    if (!sourceVideo.paused && !sourceVideo.ended) {
      animationFrameId = window.requestAnimationFrame(renderLoop);
    }
  };

  params.onProgress?.({
    progress: 0.04,
    message:
      params.templateId === "rep-bingo"
        ? "Preparing rep timing for the template..."
        : "Preparing your recording for the template..."
  });

  recorder.start(250);
  try {
    await audioContext.resume();
  } catch {
    // The generated export can still proceed without audible monitor output.
  }

  try {
    await sourceVideo.play();
  } catch {
    cleanup();
    throw new Error("The source video could not start playing for template rendering.");
  }

  if (params.templateId === "rep-bingo" && repMomentsSec.length > 0) {
    const playbackStartAudioTime = audioContext.currentTime;
    repMomentsSec.forEach((repMomentSec) => {
      scheduleRepChime(
        audioContext,
        audioDestination,
        playbackStartAudioTime + repMomentSec
      );
    });
  }

  renderLoop();
  await waitForEvent(sourceVideo, "ended");
  drawFrameForTemplate({
    templateId: params.templateId,
    context,
    video: sourceVideo,
    canvasWidth: outputSize.width,
    canvasHeight: outputSize.height,
    focusX,
    focusY,
    zoom,
    activeRepBubbleStrength: 0,
    completedRepCount
  });

  params.onProgress?.({
    progress: 0.99,
    message: "Wrapping up the edited export..."
  });

  if (recorder.state !== "inactive") {
    recorder.stop();
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
