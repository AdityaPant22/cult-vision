import { useEffect, useRef, useState } from "react";
import { RecordingAsset } from "../../recording-library/model/types";

export function useRecordingAssets() {
  const [recordingAssets, setRecordingAssets] = useState<Record<string, RecordingAsset>>({});
  const recordingAssetsRef = useRef<Record<string, RecordingAsset>>({});

  useEffect(() => {
    recordingAssetsRef.current = recordingAssets;
  }, [recordingAssets]);

  useEffect(() => {
    return () => {
      Object.values(recordingAssetsRef.current).forEach((asset) => {
        URL.revokeObjectURL(asset.url);
      });
    };
  }, []);

  const storeRecordingBlob = (params: {
    recordingId: string;
    blob: Blob;
    fallbackMimeType: string;
  }) => {
    const localUrl = URL.createObjectURL(params.blob);
    setRecordingAssets((current) => {
      const previous = current[params.recordingId];
      if (previous) {
        URL.revokeObjectURL(previous.url);
      }

      return {
        ...current,
        [params.recordingId]: {
          url: localUrl,
          mimeType: params.blob.type || params.fallbackMimeType
        }
      };
    });
  };

  const clearRecordingAssets = () => {
    Object.values(recordingAssetsRef.current).forEach((asset) => {
      URL.revokeObjectURL(asset.url);
    });
    setRecordingAssets({});
  };

  const deleteRecordingAsset = (recordingId: string) => {
    const existingAsset = recordingAssetsRef.current[recordingId];
    if (!existingAsset) {
      return;
    }

    URL.revokeObjectURL(existingAsset.url);
    setRecordingAssets((current) => {
      const next = { ...current };
      delete next[recordingId];
      return next;
    });
  };

  return {
    recordingAssets,
    storeRecordingBlob,
    clearRecordingAssets,
    deleteRecordingAsset
  };
}
