import { useEffect, useRef, useState } from "react";
import { createClientId } from "../../../shared/lib/ids";
import { UploadedAnalysisFile } from "./types";

export function useUploadedAnalysisFiles() {
  const [uploadedAnalysisFiles, setUploadedAnalysisFiles] = useState<UploadedAnalysisFile[]>(
    []
  );
  const uploadedAnalysisFilesRef = useRef<UploadedAnalysisFile[]>([]);

  useEffect(() => {
    uploadedAnalysisFilesRef.current = uploadedAnalysisFiles;
  }, [uploadedAnalysisFiles]);

  useEffect(() => {
    return () => {
      uploadedAnalysisFilesRef.current.forEach((file) => {
        URL.revokeObjectURL(file.url);
      });
    };
  }, []);

  const uploadAnalysisFiles = (files: FileList | null) => {
    if (!files) {
      return;
    }

    const nextFiles = Array.from(files)
      .filter((file) => file.type.startsWith("video/"))
      .map((file) => ({
        id: createClientId("upload"),
        name: file.name,
        url: URL.createObjectURL(file),
        mimeType: file.type || "video/mp4",
        size: file.size,
        file
      }));

    if (nextFiles.length === 0) {
      return;
    }

    setUploadedAnalysisFiles((current) => [...nextFiles, ...current]);
  };

  const deleteUploadedAnalysisFile = (fileId: string) => {
    const file = uploadedAnalysisFilesRef.current.find((item) => item.id === fileId);
    if (file) {
      URL.revokeObjectURL(file.url);
    }

    setUploadedAnalysisFiles((current) => current.filter((item) => item.id !== fileId));
  };

  const clearUploadedAnalysisFiles = () => {
    uploadedAnalysisFilesRef.current.forEach((file) => {
      URL.revokeObjectURL(file.url);
    });
    setUploadedAnalysisFiles([]);
  };

  return {
    uploadedAnalysisFiles,
    uploadAnalysisFiles,
    deleteUploadedAnalysisFile,
    clearUploadedAnalysisFiles
  };
}
