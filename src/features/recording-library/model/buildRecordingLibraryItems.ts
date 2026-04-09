import {
  absoluteAssetUrl,
  BackendRecordingItem,
  mapAnalysisResult
} from "../../../api/analysisApi";
import { Recording, RecordingLibraryItem } from "../../../types";
import {
  EditedRecordingAsset,
  EditedRecordingAssetsByRecording,
  RecordingAsset,
  SelectedTemplateIdsByRecording
} from "./types";

function mapEditedVersions(
  editedAssets: Partial<Record<string, EditedRecordingAsset>> | undefined,
  selectedTemplateId: string | null | undefined
) {
  const editedVersions = Object.values(editedAssets ?? {})
    .filter((asset): asset is EditedRecordingAsset => !!asset)
    .map((asset) => ({
      templateId: asset.templateId,
      templateName: asset.templateName,
      playbackUrl: asset.url,
      mimeType: asset.mimeType,
      createdAt: asset.createdAt
    }));

  const editedVersion =
    editedVersions.find((version) => version.templateId === selectedTemplateId) ?? null;

  return {
    editedVersions,
    editedVersion
  };
}

export function buildRecordingLibraryItems(params: {
  localRecordings: Recording[];
  serverRecordings: BackendRecordingItem[];
  recordingAssets: Record<string, RecordingAsset>;
  editedRecordingAssets: EditedRecordingAssetsByRecording;
  selectedTemplateIds: SelectedTemplateIdsByRecording;
  deviceName: string;
  zoneName: string;
}): RecordingLibraryItem[] {
  const merged = new Map<string, RecordingLibraryItem>();

  params.localRecordings.forEach((recording) => {
    const localAsset = params.recordingAssets[recording.id];
    const liveRepEvents = recording.liveRepEvents ?? [];
    const selectedTemplateId = params.selectedTemplateIds[recording.id] ?? null;
    const { editedVersion, editedVersions } = mapEditedVersions(
      params.editedRecordingAssets[recording.id],
      selectedTemplateId
    );

    merged.set(recording.id, {
      id: recording.id,
      userName: recording.userName,
      deviceName: params.deviceName,
      zoneName: params.zoneName,
      startedAt: recording.startedAt,
      stoppedAt: recording.stoppedAt,
      durationSec: recording.durationSec,
      status: recording.status,
      playbackUrl: localAsset?.url ?? null,
      mimeType: localAsset?.mimeType ?? null,
      editedVersion,
      editedVersions,
      selectedEditedTemplateId: selectedTemplateId,
      analysisResult: null,
      templateRepEvents: liveRepEvents,
      templateRepCount: liveRepEvents.length,
      templateTimingSource: liveRepEvents.length > 0 ? "live" : "none"
    });
  });

  params.serverRecordings.forEach((recording) => {
    const previous = merged.get(recording.id);
    const localAsset = params.recordingAssets[recording.id];
    const analysisResult = mapAnalysisResult(recording.latest_result);
    const liveRepEvents = previous?.templateRepEvents ?? [];
    const finalRepEvents = analysisResult?.repEvents ?? [];
    const finalRepEventCount = finalRepEvents.length;
    const liveRepEventCount = liveRepEvents.length;
    const hasEstimatedFinalRepCount =
      finalRepEventCount === 0 && (analysisResult?.repCount ?? 0) > 0;
    const shouldUseFinalRepEvents =
      finalRepEventCount > 0 && finalRepEventCount >= liveRepEventCount;
    const templateRepEvents = shouldUseFinalRepEvents ? finalRepEvents : liveRepEvents;
    const templateRepCount =
      templateRepEvents.length > 0
        ? templateRepEvents.length
        : hasEstimatedFinalRepCount
          ? analysisResult?.repCount ?? 0
          : 0;
    const templateTimingSource: RecordingLibraryItem["templateTimingSource"] =
      shouldUseFinalRepEvents
        ? "final"
        : liveRepEventCount > 0
          ? "live"
          : hasEstimatedFinalRepCount
            ? "estimated"
            : "none";
    const selectedTemplateId = params.selectedTemplateIds[recording.id] ?? null;
    const { editedVersion, editedVersions } = mapEditedVersions(
      params.editedRecordingAssets[recording.id],
      selectedTemplateId
    );

    merged.set(recording.id, {
      id: recording.id,
      userName: recording.user_name,
      deviceName: recording.device_name,
      zoneName: recording.zone_name,
      startedAt: recording.started_at,
      stoppedAt: recording.stopped_at,
      durationSec: recording.duration_sec,
      status: recording.status,
      playbackUrl: localAsset?.url ?? absoluteAssetUrl(recording.asset_url),
      mimeType: localAsset?.mimeType ?? recording.mime_type,
      editedVersion: editedVersion ?? previous?.editedVersion ?? null,
      editedVersions:
        editedVersions.length > 0 ? editedVersions : previous?.editedVersions ?? [],
      selectedEditedTemplateId: selectedTemplateId,
      analysisResult: analysisResult ?? previous?.analysisResult ?? null,
      templateRepEvents,
      templateRepCount,
      templateTimingSource
    });
  });

  return Array.from(merged.values()).sort(
    (left, right) =>
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
  );
}
