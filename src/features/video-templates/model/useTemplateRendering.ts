import { useCallback, useEffect, useRef, useState } from "react";
import { getVideoTemplates, renderVideoTemplate } from "../../../editing/videoTemplates";
import { RecordingLibraryItem, VideoTemplateId } from "../../../types";
import {
  EditedRecordingAsset,
  EditedRecordingAssetsByRecording,
  SelectedTemplateIdsByRecording,
  TemplateProcessingState,
  TemplateProcessingStatesByKey
} from "../../recording-library/model/types";

type TemplateRenderJob = {
  recording: RecordingLibraryItem;
  templateId: VideoTemplateId;
};

function expandLinkedTemplateIds(templateId: VideoTemplateId): VideoTemplateId[] {
  if (templateId === "primary" || templateId === "primary-dhurandhar") {
    return ["primary", "primary-dhurandhar"];
  }

  return [templateId];
}

function getTemplateKey(recordingId: string, templateId: VideoTemplateId) {
  return `${recordingId}::${templateId}`;
}

function canRenderTemplate(recording: RecordingLibraryItem, templateId: VideoTemplateId) {
  const template = getVideoTemplates().find((item) => item.id === templateId);
  if (!recording.playbackUrl || !template) {
    return false;
  }

  if (template.requiresRepTiming && recording.templateRepCount < 1) {
    return false;
  }

  return true;
}

function revokeEditedAssetUrls(
  assetsByRecording: EditedRecordingAssetsByRecording,
  recordingId?: string
) {
  Object.entries(assetsByRecording).forEach(([currentRecordingId, templates]) => {
    if (recordingId && currentRecordingId !== recordingId) {
      return;
    }

    Object.values(templates).forEach((asset) => {
      if (asset) {
        URL.revokeObjectURL(asset.url);
      }
    });
  });
}

export function useTemplateRendering(params: {
  onError: (message: string | null) => void;
}) {
  const [editedRecordingAssets, setEditedRecordingAssets] =
    useState<EditedRecordingAssetsByRecording>({});
  const [selectedTemplateIds, setSelectedTemplateIds] =
    useState<SelectedTemplateIdsByRecording>({});
  const [templateProcessingStates, setTemplateProcessingStates] =
    useState<TemplateProcessingStatesByKey>({});
  const [queuedTemplateIdsByRecording, setQueuedTemplateIdsByRecording] = useState<
    Partial<Record<string, VideoTemplateId[]>>
  >({});

  const editedRecordingAssetsRef = useRef<EditedRecordingAssetsByRecording>({});
  const templateProcessingStatesRef = useRef<TemplateProcessingStatesByKey>({});
  const queuedTemplateIdsByRecordingRef = useRef<Partial<Record<string, VideoTemplateId[]>>>({});
  const queueRef = useRef<TemplateRenderJob[]>([]);
  const isProcessingQueueRef = useRef(false);

  useEffect(() => {
    editedRecordingAssetsRef.current = editedRecordingAssets;
  }, [editedRecordingAssets]);

  useEffect(() => {
    templateProcessingStatesRef.current = templateProcessingStates;
  }, [templateProcessingStates]);

  useEffect(() => {
    queuedTemplateIdsByRecordingRef.current = queuedTemplateIdsByRecording;
  }, [queuedTemplateIdsByRecording]);

  useEffect(() => {
    return () => {
      revokeEditedAssetUrls(editedRecordingAssetsRef.current);
    };
  }, []);

  const clearEditedRecordingAssets = useCallback(() => {
    revokeEditedAssetUrls(editedRecordingAssetsRef.current);
    queueRef.current = [];
    setEditedRecordingAssets({});
    setSelectedTemplateIds({});
    setTemplateProcessingStates({});
    setQueuedTemplateIdsByRecording({});
  }, []);

  const deleteEditedRecordingAsset = useCallback((recordingId: string) => {
    revokeEditedAssetUrls(editedRecordingAssetsRef.current, recordingId);
    queueRef.current = queueRef.current.filter((job) => job.recording.id !== recordingId);

    setEditedRecordingAssets((current) => {
      if (!current[recordingId]) {
        return current;
      }

      const next = { ...current };
      delete next[recordingId];
      return next;
    });

    setSelectedTemplateIds((current) => {
      if (!(recordingId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[recordingId];
      return next;
    });

    setTemplateProcessingStates((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${recordingId}::`))
      )
    );

    setQueuedTemplateIdsByRecording((current) => {
      if (!current[recordingId]) {
        return current;
      }

      const next = { ...current };
      delete next[recordingId];
      return next;
    });
  }, []);

  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) {
      return;
    }

    isProcessingQueueRef.current = true;

    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift();
      if (!job) {
        break;
      }

      const { recording, templateId } = job;
      const templateKey = getTemplateKey(recording.id, templateId);

      setQueuedTemplateIdsByRecording((current) => {
        const currentQueued = current[recording.id] ?? [];
        const nextQueued = currentQueued.filter((id) => id !== templateId);
        if (nextQueued.length === currentQueued.length) {
          return current;
        }

        if (nextQueued.length === 0) {
          const next = { ...current };
          delete next[recording.id];
          return next;
        }

        return {
          ...current,
          [recording.id]: nextQueued
        };
      });

      setTemplateProcessingStates((current) => ({
        ...current,
        [templateKey]: {
          recordingId: recording.id,
          templateId,
          progress: 0.02,
          message: "Preparing your template...",
          error: null
        }
      }));

      try {
        const rendered = await renderVideoTemplate({
          sourceUrl: recording.playbackUrl!,
          templateId,
          repEvents: recording.templateRepEvents,
          repCount: recording.templateRepCount,
          durationSec: recording.durationSec,
          titleText: recording.analysisResult?.exercise ?? "Strength Session",
          subjectName: recording.userName,
          onProgress: ({ progress, message }) => {
            setTemplateProcessingStates((current) => ({
              ...current,
              [templateKey]: {
                recordingId: recording.id,
                templateId,
                progress,
                message,
                error: null
              }
            }));
          }
        });

        const nextUrl = URL.createObjectURL(rendered.blob);

        setEditedRecordingAssets((current) => {
          const previousAsset = current[recording.id]?.[templateId];
          if (previousAsset) {
            URL.revokeObjectURL(previousAsset.url);
          }

          return {
            ...current,
            [recording.id]: {
              ...(current[recording.id] ?? {}),
              [templateId]: {
                templateId: rendered.templateId,
                templateName: rendered.templateName,
                url: nextUrl,
                mimeType: rendered.mimeType,
                createdAt: new Date().toISOString()
              }
            }
          };
        });

        setSelectedTemplateIds((current) => {
          if (current[recording.id]) {
            return current;
          }

          return {
            ...current,
            [recording.id]: rendered.templateId
          };
        });

        setTemplateProcessingStates((current) => ({
          ...current,
          [templateKey]: {
            recordingId: recording.id,
            templateId,
            progress: 1,
            message: "Edited video ready.",
            error: null
          }
        }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The template could not be applied.";

        setTemplateProcessingStates((current) => ({
          ...current,
          [templateKey]: {
            recordingId: recording.id,
            templateId,
            progress: 1,
            message: "Template render failed.",
            error: message
          }
        }));
        params.onError(message);
      }
    }

    isProcessingQueueRef.current = false;
  }, [params.onError]);

  const enqueueTemplateRender = useCallback(
    (recording: RecordingLibraryItem, templateId: VideoTemplateId, forceRetry = false) => {
      if (!canRenderTemplate(recording, templateId)) {
        return;
      }

      const templateKey = getTemplateKey(recording.id, templateId);
      const alreadyRendered = !!editedRecordingAssetsRef.current[recording.id]?.[templateId];
      const isQueued =
        (queuedTemplateIdsByRecordingRef.current[recording.id]?.includes(templateId) ?? false) ||
        queueRef.current.some(
          (job) => job.recording.id === recording.id && job.templateId === templateId
        );
      const existingProcessingState = templateProcessingStatesRef.current[templateKey];
      const isProcessing =
        !!existingProcessingState &&
        !existingProcessingState.error &&
        existingProcessingState.progress < 1;
      const hasFailedPreviously = !!existingProcessingState?.error;

      if (alreadyRendered || isQueued || isProcessing) {
        return;
      }

      if (hasFailedPreviously && !forceRetry) {
        return;
      }

      queueRef.current.push({ recording, templateId });
      setQueuedTemplateIdsByRecording((current) => {
        const nextQueued = current[recording.id] ?? [];
        if (nextQueued.includes(templateId)) {
          return current;
        }

        return {
          ...current,
          [recording.id]: [...nextQueued, templateId]
        };
      });
      setTemplateProcessingStates((current) => {
        if (!forceRetry || !current[templateKey]) {
          return current;
        }

        return {
          ...current,
          [templateKey]: {
            ...current[templateKey],
            progress: 0,
            message: "Queued for rendering...",
            error: null
          }
        };
      });

      void processQueue();
    },
    [processQueue]
  );

  const startTemplateRender = useCallback(
    (
      recordingLibraryItems: RecordingLibraryItem[],
      recordingId: string,
      templateId: VideoTemplateId
    ) => {
      const targetRecording =
        recordingLibraryItems.find((recording) => recording.id === recordingId) ?? null;

      if (!targetRecording) {
        return;
      }

      expandLinkedTemplateIds(templateId).forEach((linkedTemplateId) => {
        enqueueTemplateRender(targetRecording, linkedTemplateId);
      });
    },
    [enqueueTemplateRender]
  );

  const autoRenderTemplatesForRecording = useCallback(
    (recordingLibraryItems: RecordingLibraryItem[], recordingId: string) => {
      const targetRecording =
        recordingLibraryItems.find((recording) => recording.id === recordingId) ?? null;

      if (!targetRecording?.playbackUrl) {
        return;
      }

      getVideoTemplates().forEach((template) => {
        enqueueTemplateRender(targetRecording, template.id);
      });
    },
    [enqueueTemplateRender]
  );

  const retryTemplateRender = useCallback(
    (
      recordingLibraryItems: RecordingLibraryItem[],
      recordingId: string,
      templateId: VideoTemplateId
    ) => {
      const targetRecording =
        recordingLibraryItems.find((recording) => recording.id === recordingId) ?? null;

      if (!targetRecording) {
        return;
      }

      expandLinkedTemplateIds(templateId).forEach((linkedTemplateId) => {
        enqueueTemplateRender(targetRecording, linkedTemplateId, true);
      });
    },
    [enqueueTemplateRender]
  );

  const selectTemplateForRecording = useCallback(
    (recordingId: string, templateId: VideoTemplateId) => {
      if (!editedRecordingAssetsRef.current[recordingId]?.[templateId]) {
        return;
      }

      setSelectedTemplateIds((current) => ({
        ...current,
        [recordingId]: templateId
      }));
    },
    []
  );

  const getTemplateProcessingState = useCallback(
    (recordingId: string, templateId: VideoTemplateId): TemplateProcessingState | null =>
      templateProcessingStatesRef.current[getTemplateKey(recordingId, templateId)] ?? null,
    []
  );

  return {
    editedRecordingAssets,
    selectedTemplateIds,
    templateProcessingStates,
    queuedTemplateIdsByRecording,
    startTemplateRender,
    autoRenderTemplatesForRecording,
    retryTemplateRender,
    selectTemplateForRecording,
    getTemplateProcessingState,
    clearEditedRecordingAssets,
    deleteEditedRecordingAsset
  };
}
