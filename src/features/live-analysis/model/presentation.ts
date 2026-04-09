import { LiveAnalysisUpdate } from "../../../api/analysisApi";

export function formatLiveConnectionState(
  state: "idle" | "connecting" | "live" | "offline"
): string {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "live":
      return "Guiding";
    case "offline":
      return "Offline";
    default:
      return "Waiting";
  }
}

export function formatCalibrationState(
  state: LiveAnalysisUpdate["calibration_state"] | undefined
): string {
  switch (state) {
    case "ready":
      return "Ready";
    case "weak":
      return "Adjust";
    default:
      return "Calibrating";
  }
}
