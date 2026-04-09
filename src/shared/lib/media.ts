export function getSupportedRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

export function calculateDurationSec(startedAt: string, stoppedAt: string): number {
  return Math.max(
    1,
    Math.floor((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  );
}
