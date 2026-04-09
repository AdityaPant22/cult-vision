import { useEffect, useRef } from "react";
import { LiveAnalysisUpdate } from "../../../api/analysisApi";
import { Recording } from "../../../types";

type Params = {
  view: string;
  currentRecording: Recording | null;
  liveAnalysis: LiveAnalysisUpdate | null;
  dispatch: (action: any) => void;
};

export function useLiveRepSync(params: Params) {
  const syncStateRef = useRef<{
    recordingId: string | null;
    lastObservedTimestampMs: number;
  }>({
    recordingId: null,
    lastObservedTimestampMs: 0
  });

  useEffect(() => {
    if (!params.currentRecording) {
      syncStateRef.current = {
        recordingId: null,
        lastObservedTimestampMs: 0
      };
      return;
    }

    if (syncStateRef.current.recordingId !== params.currentRecording.id) {
      const lastExistingTimestampMs =
        params.currentRecording.liveRepEvents?.[params.currentRecording.liveRepEvents.length - 1]
          ?.timestampMs ?? 0;

      syncStateRef.current = {
        recordingId: params.currentRecording.id,
        lastObservedTimestampMs: lastExistingTimestampMs
      };
    }
  }, [params.currentRecording]);

  useEffect(() => {
    if (params.view !== "recording" || !params.currentRecording || !params.liveAnalysis) {
      return;
    }

    const nextRepCount = Math.max(0, params.liveAnalysis.rep_count ?? 0);
    const existingRepEvents = params.currentRecording.liveRepEvents ?? [];
    const currentRepCount = existingRepEvents.length;
    const startedAtMs = new Date(params.currentRecording.startedAt).getTime();
    const eventBaseTimestampMs = Math.max(0, Date.now() - startedAtMs);

    if (nextRepCount <= currentRepCount) {
      syncStateRef.current = {
        recordingId: params.currentRecording.id,
        lastObservedTimestampMs: eventBaseTimestampMs
      };
      return;
    }

    const nextEvents = [...existingRepEvents];
    const newRepCount = nextRepCount - currentRepCount;
    const lastExistingTimestampMs =
      existingRepEvents[existingRepEvents.length - 1]?.timestampMs ?? 0;
    const anchorTimestampMs = Math.max(
      lastExistingTimestampMs,
      syncStateRef.current.lastObservedTimestampMs
    );
    const minimumWindowMs = newRepCount > 1 ? newRepCount * 650 : 0;
    const inferredWindowMs = Math.max(
      minimumWindowMs,
      Math.max(0, eventBaseTimestampMs - anchorTimestampMs)
    );
    const nextTimestamps = Array.from({ length: newRepCount }, (_, offset) => {
      if (newRepCount === 1) {
        return eventBaseTimestampMs;
      }

      const startTimestampMs = Math.max(0, eventBaseTimestampMs - inferredWindowMs);
      const stepMs = inferredWindowMs / newRepCount;
      return Math.max(0, Math.round(startTimestampMs + stepMs * (offset + 1)));
    });

    for (let offset = 0; offset < newRepCount; offset += 1) {
      const repIndex = currentRepCount + offset + 1;
      nextEvents.push({
        repIndex,
        timestampMs: nextTimestamps[offset] ?? eventBaseTimestampMs,
        qualityScore: 82,
        notes: "Captured from live rep tracking during recording."
      });
    }

    syncStateRef.current = {
      recordingId: params.currentRecording.id,
      lastObservedTimestampMs: eventBaseTimestampMs
    };

    params.dispatch({
      type: "SYNC_RECORDING_LIVE_REP_EVENTS",
      payload: {
        recordingId: params.currentRecording.id,
        repEvents: nextEvents
      }
    });
  }, [params.currentRecording, params.dispatch, params.liveAnalysis, params.view]);
}
