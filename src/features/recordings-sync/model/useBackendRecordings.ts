import { useEffect, useRef, useState } from "react";
import {
  BACKEND_OFFLINE_MESSAGE,
  BackendRecordingItem,
  checkBackendHealth,
  listBackendRecordings
} from "../../../api/analysisApi";
import { AppRoute } from "../../../app/router/useAppRoute";

const SERVER_SYNC_STATUSES = new Set(["recording", "processing", "uploading"]);
const CLOUD_SYNCING_STATUSES = new Set(["awaiting_render", "uploading_video", "saving_data", "video_uploaded"]);

let toastCounter = 0;

export interface SyncToast {
  id: number;
  message: string;
  type: "success" | "info";
}

export function useBackendRecordings(params: {
  route: AppRoute;
  isRecordingsOpen: boolean;
  onError: (message: string | null) => void;
}) {
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">(
    "checking"
  );
  const [serverRecordings, setServerRecordings] = useState<BackendRecordingItem[]>([]);
  const [syncToasts, setSyncToasts] = useState<SyncToast[]>([]);
  const prevSyncStatusRef = useRef<Map<string, string | null>>(new Map());

  const showToast = (message: string, type: SyncToast["type"] = "success") => {
    const id = ++toastCounter;
    setSyncToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setSyncToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2000);
  };

  const verifyBackendConnection = async (showError = false): Promise<boolean> => {
    try {
      await checkBackendHealth();
      setBackendStatus("online");
      return true;
    } catch (error) {
      setBackendStatus("offline");
      if (showError) {
        params.onError(error instanceof Error ? error.message : BACKEND_OFFLINE_MESSAGE);
      }
      return false;
    }
  };

  const refreshRecordingsFromServer = async (silent = false) => {
    try {
      const recordings = await listBackendRecordings();

      const prevMap = prevSyncStatusRef.current;
      for (const rec of recordings) {
        const hadPriorPoll = prevMap.has(rec.id);
        const prev = prevMap.get(rec.id) ?? null;
        if (
          hadPriorPoll &&
          prev !== rec.cloud_sync_status &&
          rec.cloud_sync_status
        ) {
          if (rec.cloud_sync_status === "video_uploaded") {
            showToast("Video saved to cloud");
          } else if (rec.cloud_sync_status === "synced") {
            showToast("Workout data saved");
          }
        }
        prevMap.set(rec.id, rec.cloud_sync_status);
      }

      setServerRecordings(recordings);
      setBackendStatus("online");
    } catch (error) {
      setBackendStatus("offline");
      if (!silent) {
        params.onError(
          error instanceof Error
            ? error.message
            : "Could not refresh recordings from the analysis service."
        );
      }
    }
  };

  useEffect(() => {
    void verifyBackendConnection(false);
    void refreshRecordingsFromServer(true);
  }, []);

  useEffect(() => {
    if (params.route !== "analysis" && !params.isRecordingsOpen) {
      return;
    }

    void refreshRecordingsFromServer(true);
  }, [params.isRecordingsOpen, params.route]);

  useEffect(() => {
    const shouldPoll =
      serverRecordings.some((recording) => SERVER_SYNC_STATUSES.has(recording.status)) ||
      serverRecordings.some(
        (recording) =>
          recording.cloud_sync_status !== null &&
          CLOUD_SYNCING_STATUSES.has(recording.cloud_sync_status)
      );

    if (!shouldPoll) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshRecordingsFromServer(true);
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [serverRecordings]);

  return {
    backendStatus,
    serverRecordings,
    syncToasts,
    refreshRecordingsFromServer,
    verifyBackendConnection
  };
}
