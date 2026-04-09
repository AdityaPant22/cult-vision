import {
  absoluteAssetUrl,
  BackendRecordingItem,
  mapAnalysisResult
} from "../../../api/analysisApi";
import { Recording, RecordingLibraryItem } from "../../../types";
import { EditedRecordingAsset, RecordingAsset } from "./types";

export function buildRecordingLibraryItems(params: {
  localRecordings: Recording[];
  serverRecordings: BackendRecordingItem[];
  recordingAssets: Record<string, RecordingAsset>;
  editedRecordingAssets: Record<string, EditedRecordingAsset>;
  deviceName: string;
  zoneName: string;
}): RecordingLibraryItem[] {
  const merged = new Map<string, RecordingLibraryItem>();

  params.localRecordings.forEach((recording) => {
    const localAsset = params.recordingAssets[recording.id];
    const liveRepEvents = recording.liveRepEvents ?? [];
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
      editedVersion: params.editedRecordingAssets[recording.id]
        ? {
            templateId: params.editedRecordingAssets[recording.id].templateId,
            templateName: params.editedRecordingAssets[recording.id].templateName,
            playbackUrl: params.editedRecordingAssets[recording.id].url,
            mimeType: params.editedRecordingAssets[recording.id].mimeType,
            createdAt: params.editedRecordingAssets[recording.id].createdAt
          }
        : null,
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
    const hasFinalRepEvents = (analysisResult?.repEvents.length ?? 0) > 0;
    const hasEstimatedFinalRepCount = !hasFinalRepEvents && (analysisResult?.repCount ?? 0) > 0;
    const templateRepEvents = hasFinalRepEvents
      ? analysisResult?.repEvents ?? []
      : liveRepEvents;
    const templateRepCount = hasFinalRepEvents
      ? analysisResult?.repEvents.length ?? 0
      : hasEstimatedFinalRepCount
        ? analysisResult?.repCount ?? 0
        : liveRepEvents.length;
    const templateTimingSource: RecordingLibraryItem["templateTimingSource"] = hasFinalRepEvents
      ? "final"
      : hasEstimatedFinalRepCount
        ? "estimated"
        : liveRepEvents.length > 0
          ? "live"
          : "none";

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
      editedVersion: params.editedRecordingAssets[recording.id]
        ? {
            templateId: params.editedRecordingAssets[recording.id].templateId,
            templateName: params.editedRecordingAssets[recording.id].templateName,
            playbackUrl: params.editedRecordingAssets[recording.id].url,
            mimeType: params.editedRecordingAssets[recording.id].mimeType,
            createdAt: params.editedRecordingAssets[recording.id].createdAt
          }
        : previous?.editedVersion ?? null,
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
