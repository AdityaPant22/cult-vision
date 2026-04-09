import { useEffect, useState } from "react";
import {
  BACKEND_OFFLINE_MESSAGE,
  BackendRecordingItem,
  checkBackendHealth,
  listBackendRecordings
} from "../../../api/analysisApi";
import { AppRoute } from "../../../app/router/useAppRoute";

const SERVER_SYNC_STATUSES = new Set(["recording", "processing", "uploading"]);

export function useBackendRecordings(params: {
  route: AppRoute;
  isRecordingsOpen: boolean;
  onError: (message: string | null) => void;
}) {
  const [backendStatus, setBackendStatus] = useState<"checking" | "online" | "offline">(
    "checking"
  );
  const [serverRecordings, setServerRecordings] = useState<BackendRecordingItem[]>([]);

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
    const shouldPoll = serverRecordings.some((recording) =>
      SERVER_SYNC_STATUSES.has(recording.status)
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
    refreshRecordingsFromServer,
    verifyBackendConnection
  };
}
