import { useEffect } from "react";
import { LiveAnalysisUpdate } from "../../../api/analysisApi";
import { Recording } from "../../../types";

type Params = {
  view: string;
  currentRecording: Recording | null;
  liveAnalysis: LiveAnalysisUpdate | null;
  dispatch: (action: any) => void;
};

export function useLiveRepSync(params: Params) {
  useEffect(() => {
    if (params.view !== "recording" || !params.currentRecording || !params.liveAnalysis) {
      return;
    }

    const nextRepCount = Math.max(0, params.liveAnalysis.rep_count ?? 0);
    const existingRepEvents = params.currentRecording.liveRepEvents ?? [];
    const currentRepCount = existingRepEvents.length;

    if (nextRepCount <= currentRepCount) {
      return;
    }

    const startedAtMs = new Date(params.currentRecording.startedAt).getTime();
    const eventBaseTimestampMs = Math.max(0, Date.now() - startedAtMs);
    const nextEvents = [...existingRepEvents];
    const newRepCount = nextRepCount - currentRepCount;

    for (let offset = 0; offset < newRepCount; offset += 1) {
      const repIndex = currentRepCount + offset + 1;
      nextEvents.push({
        repIndex,
        timestampMs: Math.max(0, eventBaseTimestampMs - (newRepCount - offset - 1) * 140),
        qualityScore: 82,
        notes: "Captured from live rep tracking during recording."
      });
    }

    params.dispatch({
      type: "SYNC_RECORDING_LIVE_REP_EVENTS",
      payload: {
        recordingId: params.currentRecording.id,
        repEvents: nextEvents
      }
    });
  }, [params.currentRecording, params.dispatch, params.liveAnalysis, params.view]);
}
