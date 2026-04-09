export interface UploadedAnalysisFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  file: File;
}
