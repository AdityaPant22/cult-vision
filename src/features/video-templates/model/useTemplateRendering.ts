import { useEffect, useRef, useState } from "react";
import { RecordingLibraryItem, VideoTemplateId } from "../../../types";
import { renderVideoTemplate } from "../../../editing/videoTemplates";
import { EditedRecordingAsset, TemplateProcessingState } from "../../recording-library/model/types";

export function useTemplateRendering(params: {
  onError: (message: string | null) => void;
}) {
  const [editedRecordingAssets, setEditedRecordingAssets] = useState<
    Record<string, EditedRecordingAsset>
  >({});
  const [templateProcessingState, setTemplateProcessingState] =
    useState<TemplateProcessingState | null>(null);
  const editedRecordingAssetsRef = useRef<Record<string, EditedRecordingAsset>>({});

  useEffect(() => {
    editedRecordingAssetsRef.current = editedRecordingAssets;
  }, [editedRecordingAssets]);

  useEffect(() => {
    return () => {
      Object.values(editedRecordingAssetsRef.current).forEach((asset) => {
        URL.revokeObjectURL(asset.url);
      });
    };
  }, []);

  const clearEditedRecordingAssets = () => {
    Object.values(editedRecordingAssetsRef.current).forEach((asset) => {
      URL.revokeObjectURL(asset.url);
    });
    setEditedRecordingAssets({});
  };

  const deleteEditedRecordingAsset = (recordingId: string) => {
    const existingAsset = editedRecordingAssetsRef.current[recordingId];
    if (existingAsset) {
      URL.revokeObjectURL(existingAsset.url);
      setEditedRecordingAssets((current) => {
        const next = { ...current };
        delete next[recordingId];
        return next;
      });
    }
  };

  const applyTemplateToRecording = async (
    recordingLibraryItems: RecordingLibraryItem[],
    recordingId: string,
    templateId: VideoTemplateId
  ) => {
    const targetRecording =
      recordingLibraryItems.find((recording) => recording.id === recordingId) ?? null;

    if (!targetRecording?.playbackUrl) {
      params.onError("This recording is not available for editing in the current browser.");
      return;
    }

    params.onError(null);
    setTemplateProcessingState({
      recordingId,
      templateId,
      progress: 0.02,
      message: "Preparing your template...",
      error: null
    });

    try {
      const rendered = await renderVideoTemplate({
        sourceUrl: targetRecording.playbackUrl,
        templateId,
        repEvents: targetRecording.templateRepEvents,
        repCount: targetRecording.templateRepCount,
        durationSec: targetRecording.durationSec,
        onProgress: ({ progress, message }) => {
          setTemplateProcessingState((current) =>
            current && current.recordingId === recordingId && current.templateId === templateId
              ? {
                  ...current,
                  progress,
                  message,
                  error: null
                }
              : current
          );
        }
      });

      const nextUrl = URL.createObjectURL(rendered.blob);
      setEditedRecordingAssets((current) => {
        const previous = current[recordingId];
        if (previous) {
          URL.revokeObjectURL(previous.url);
        }

        return {
          ...current,
          [recordingId]: {
            templateId: rendered.templateId,
            templateName: rendered.templateName,
            url: nextUrl,
            mimeType: rendered.mimeType,
            createdAt: new Date().toISOString()
          }
        };
      });

      setTemplateProcessingState({
        recordingId,
        templateId,
        progress: 1,
        message: "Edited video ready.",
        error: null
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The template could not be applied.";
      setTemplateProcessingState({
        recordingId,
        templateId,
        progress: 1,
        message: "Template render failed.",
        error: message
      });
      params.onError(message);
    }
  };

  return {
    editedRecordingAssets,
    templateProcessingState,
    applyTemplateToRecording,
    clearEditedRecordingAssets,
    deleteEditedRecordingAsset,
    setTemplateProcessingState
  };
}
