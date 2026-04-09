export function formatDuration(totalSec: number): string {
  if (totalSec < 60) {
    return `${totalSec}s`;
  }

  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

export function formatTimer(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

export function formatFileSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPhaseLabel(phase: string | undefined): string {
  if (!phase) {
    return "--";
  }

  return phase
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
