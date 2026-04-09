import { VideoTemplateId } from "../../../types";

export type RecordingAsset = {
  url: string;
  mimeType: string;
};

export type EditedRecordingAsset = {
  templateId: VideoTemplateId;
  templateName: string;
  url: string;
  mimeType: string;
  createdAt: string;
};

export type EditedRecordingAssetsByRecording = Record<
  string,
  Partial<Record<VideoTemplateId, EditedRecordingAsset>>
>;

export type SelectedTemplateIdsByRecording = Partial<Record<string, VideoTemplateId>>;

export type TemplateProcessingState = {
  recordingId: string;
  templateId: VideoTemplateId;
  progress: number;
  message: string;
  error: string | null;
};

export type TemplateProcessingStatesByKey = Record<string, TemplateProcessingState>;
