import { AnalysisPage } from "../components/AnalysisPage";
import { UploadedAnalysisFile } from "../features/analysis-uploads/model/types";
import { RecordingLibraryItem } from "../types";

interface AnalysisWorkspacePageProps {
  recordings: RecordingLibraryItem[];
  uploadedFiles: UploadedAnalysisFile[];
  onUploadFiles: (files: FileList | null) => void;
  onDeleteRecording: (recordingId: string) => void;
  onDeleteUploadedFile: (fileId: string) => void;
  onRefreshRecordings: () => Promise<void>;
}

export function AnalysisWorkspacePage(props: AnalysisWorkspacePageProps) {
  return <AnalysisPage {...props} />;
}
