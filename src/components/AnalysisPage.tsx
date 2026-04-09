import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  AnalysisJobResponse,
  createAnalysisJobs,
  getAnalysisJob
} from "../api/analysisApi";
import { RecordingLibraryItem } from "../types";

export interface UploadedAnalysisFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  file: File;
}

interface AnalysisPageProps {
  recordings: RecordingLibraryItem[];
  uploadedFiles: UploadedAnalysisFile[];
  onUploadFiles: (files: FileList | null) => void;
  onDeleteRecording: (recordingId: string) => void;
  onDeleteUploadedFile: (fileId: string) => void;
  onRefreshRecordings: () => Promise<void>;
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(totalSec: number): string {
  if (totalSec < 60) {
    return `${totalSec}s`;
  }

  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${seconds}s`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function AnalysisPage({
  recordings,
  uploadedFiles,
  onUploadFiles,
  onDeleteRecording,
  onDeleteUploadedFile,
  onRefreshRecordings
}: AnalysisPageProps) {
  const [selectedRecordingIds, setSelectedRecordingIds] = useState<string[]>([]);
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);
  const [analysisJobs, setAnalysisJobs] = useState<AnalysisJobResponse[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<string>("");

  useEffect(() => {
    setSelectedRecordingIds((current) =>
      current.filter((id) => recordings.some((recording) => recording.id === id))
    );
  }, [recordings]);

  useEffect(() => {
    setSelectedUploadIds((current) =>
      current.filter((id) => uploadedFiles.some((file) => file.id === id))
    );
  }, [uploadedFiles]);

  const selectedCount = selectedRecordingIds.length + selectedUploadIds.length;

  const selectedRecordingItems = useMemo(
    () => recordings.filter((recording) => selectedRecordingIds.includes(recording.id)),
    [recordings, selectedRecordingIds]
  );

  const selectedUploadItems = useMemo(
    () => uploadedFiles.filter((file) => selectedUploadIds.includes(file.id)),
    [selectedUploadIds, uploadedFiles]
  );

  const handleUploadChange = (event: ChangeEvent<HTMLInputElement>) => {
    onUploadFiles(event.target.files);
    event.target.value = "";
  };

  const runAnalysis = async () => {
    const selectedFiles = uploadedFiles
      .filter((file) => selectedUploadIds.includes(file.id))
      .map((file) => file.file);

    if (selectedRecordingIds.length === 0 && selectedFiles.length === 0) {
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress("Queueing analysis jobs...");

    try {
      const created = await createAnalysisJobs({
        recordingIds: selectedRecordingIds,
        files: selectedFiles
      });

      if (created.jobs.length === 0) {
        setAnalysisProgress("No analysis jobs were created. Check that your videos are available.");
        setIsAnalyzing(false);
        return;
      }

      let latestJobs = created.jobs;
      setAnalysisJobs(latestJobs);
      setAnalysisProgress(`Started ${latestJobs.length} analysis job(s).`);

      for (let attempt = 0; attempt < 60; attempt += 1) {
        const hasPendingJobs = latestJobs.some(
          (job) => job.status !== "completed" && job.status !== "failed"
        );

        if (!hasPendingJobs) {
          break;
        }

        await sleep(1500);
        latestJobs = await Promise.all(
          latestJobs.map((job) => getAnalysisJob(job.job_id))
        );
        setAnalysisJobs(latestJobs);

        const completedCount = latestJobs.filter((job) => job.status === "completed").length;
        const failedCount = latestJobs.filter((job) => job.status === "failed").length;
        setAnalysisProgress(
          `${completedCount}/${latestJobs.length} complete${
            failedCount > 0 ? `, ${failedCount} failed` : ""
          }.`
        );
      }

      await onRefreshRecordings();

      const completedCount = latestJobs.filter((job) => job.status === "completed").length;
      const failedCount = latestJobs.filter((job) => job.status === "failed").length;
      setAnalysisProgress(
        `Finished ${completedCount} job(s)${failedCount > 0 ? `, ${failedCount} failed` : ""}.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Analysis failed unexpectedly.";
      setAnalysisProgress(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const completedJobs = analysisJobs.filter((job) => job.result);

  return (
    <section className="screen analysis-page">
      <div className="recording-banner">
        <div>
          <p className="eyebrow">Analysis</p>
          <h1>Exercise Analysis Library</h1>
          <p className="subtle-copy">
            Select kiosk recordings or upload new clips. The backend will extract pose
            landmarks, classify the exercise, and score form quality.
          </p>
        </div>
        <div className="warning-card">
          <span className="label">Selected</span>
          <strong>{selectedCount} videos ready for analysis</strong>
        </div>
      </div>

      <div className="analysis-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Kiosk Recordings</h2>
            <span>{recordings.length} available</span>
          </div>
          {recordings.length === 0 ? (
            <p className="subtle-copy">Record something on the kiosk to see it here.</p>
          ) : (
            <div className="analysis-video-list">
              {recordings.map((recording) => {
                const checked = selectedRecordingIds.includes(recording.id);

                return (
                  <article key={recording.id} className="analysis-video-card">
                    <label className="analysis-select-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setSelectedRecordingIds((current) =>
                            event.target.checked
                              ? [...current, recording.id]
                              : current.filter((id) => id !== recording.id)
                          )
                        }
                      />
                      <span>
                        <strong>{recording.userName}</strong>
                        <small>
                          {formatDuration(recording.durationSec)} •{" "}
                          {new Date(recording.startedAt).toLocaleString()} • {recording.status}
                        </small>
                      </span>
                    </label>

                    <div className="analysis-card-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => onDeleteRecording(recording.id)}
                      >
                        Delete
                      </button>
                    </div>

                    {recording.playbackUrl ? (
                      <video
                        className="analysis-video-preview"
                        controls
                        playsInline
                        preload="metadata"
                        src={recording.playbackUrl}
                      />
                    ) : (
                      <div className="recording-unavailable">
                        <strong>Playback unavailable</strong>
                        <p className="subtle-copy">
                          This recording exists in metadata, but the video asset is not
                          currently reachable.
                        </p>
                      </div>
                    )}

                    {recording.analysisResult ? (
                      <div className="analysis-inline-result">
                        <div className="history-item">
                          <span>Detected</span>
                          <strong>{recording.analysisResult.exercise}</strong>
                        </div>
                        <div className="history-item">
                          <span>Overall score</span>
                          <strong>{recording.analysisResult.overallScore}/100</strong>
                        </div>
                        <div className="history-item">
                          <span>Reps</span>
                          <strong>{recording.analysisResult.repCount}</strong>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Upload Exercise Videos</h2>
            <span>{uploadedFiles.length} uploaded</span>
          </div>
          <label className="upload-zone">
            <input type="file" accept="video/*" multiple onChange={handleUploadChange} />
            <strong>Upload video files</strong>
            <span className="subtle-copy">
              Add clips from other devices or earlier sessions.
            </span>
          </label>

          {uploadedFiles.length === 0 ? null : (
            <div className="analysis-video-list">
              {uploadedFiles.map((file) => {
                const checked = selectedUploadIds.includes(file.id);

                return (
                  <article key={file.id} className="analysis-video-card">
                    <label className="analysis-select-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setSelectedUploadIds((current) =>
                            event.target.checked
                              ? [...current, file.id]
                              : current.filter((id) => id !== file.id)
                          )
                        }
                      />
                      <span>
                        <strong>{file.name}</strong>
                        <small>{formatSize(file.size)}</small>
                      </span>
                    </label>

                    <div className="analysis-card-actions">
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => onDeleteUploadedFile(file.id)}
                      >
                        Delete
                      </button>
                    </div>

                    <video
                      className="analysis-video-preview"
                      controls
                      playsInline
                      preload="metadata"
                      src={file.url}
                    />
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="analysis-grid">
        <div className="panel">
          <div className="panel-header">
            <h2>Selected Videos</h2>
            <span>{selectedCount} selected</span>
          </div>
          {selectedRecordingItems.length + selectedUploadItems.length === 0 ? (
            <p className="subtle-copy">
              Select kiosk recordings or uploaded files to prepare the analysis batch.
            </p>
          ) : (
            <div className="analysis-summary-list">
              {selectedRecordingItems.map((item) => (
                <div key={item.id} className="history-item">
                  <span>{item.userName}</span>
                  <span>{formatDuration(item.durationSec)}</span>
                </div>
              ))}
              {selectedUploadItems.map((item) => (
                <div key={item.id} className="history-item">
                  <span>{item.name}</span>
                  <span>{formatSize(item.size)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="analysis-runner">
            <button
              className="primary-button"
              type="button"
              disabled={selectedCount === 0 || isAnalyzing}
              onClick={runAnalysis}
            >
              {isAnalyzing ? "Analyzing..." : "Start Analysis"}
            </button>
            <p className="subtle-copy">
              {analysisProgress ||
                "Queue backend pose analysis for the selected exercise videos."}
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Backend Pipeline</h2>
            <span>FastAPI + MediaPipe</span>
          </div>
          <div className="analysis-engine-list">
            <article className="analysis-engine-card">
              <strong>Live Recording Flow</strong>
              <p className="subtle-copy">
                During a set, sampled preview frames stream over WebSocket for provisional
                rep count, exercise detection, and live cues.
              </p>
            </article>
            <article className="analysis-engine-card">
              <strong>Final Scoring Flow</strong>
              <p className="subtle-copy">
                After upload, the backend replays the full video with MediaPipe Pose
                Landmarker, then applies rule-based scoring for squat, push-up, and lunge.
              </p>
            </article>
            <article className="analysis-engine-card">
              <strong>Recommended Capture Setup</strong>
              <p className="subtle-copy">
                Use a fixed side angle, keep the full body in frame, and avoid multiple
                people in view. This gives the classifier and scoring rules the cleanest
                landmark signal.
              </p>
            </article>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Analysis Results</h2>
          <span>{completedJobs.length} completed</span>
        </div>
        {analysisJobs.length === 0 ? (
          <p className="subtle-copy">
            No analysis jobs yet. Select one or more videos and click `Start Analysis`.
          </p>
        ) : (
          <div className="analysis-results-grid">
            {analysisJobs.map((job) => (
              <article key={job.job_id} className="analysis-result-card">
                <div className="panel-header">
                  <div>
                    <strong>{job.source_label}</strong>
                    <p className="subtle-copy">{job.message}</p>
                  </div>
                  <span className={`status-pill ${job.status}`}>{job.status}</span>
                </div>

                {job.result ? (
                  <>
                    <div className="summary-grid">
                      <div className="summary-card">
                        <span className="label">Exercise</span>
                        <strong>{job.result.exercise}</strong>
                      </div>
                      <div className="summary-card">
                        <span className="label">Score</span>
                        <strong>{job.result.overall_score}/100</strong>
                      </div>
                      <div className="summary-card">
                        <span className="label">Reps</span>
                        <strong>{job.result.rep_count}</strong>
                      </div>
                      <div className="summary-card">
                        <span className="label">Confidence</span>
                        <strong>{Math.round(job.result.confidence * 100)}%</strong>
                      </div>
                    </div>

                    <div className="summary-grid summary-grid-tight">
                      <div className="summary-card">
                        <span className="label">Range</span>
                        <strong>{job.result.metrics.range_of_motion}</strong>
                      </div>
                      <div className="summary-card">
                        <span className="label">Stability</span>
                        <strong>{job.result.metrics.stability}</strong>
                      </div>
                      <div className="summary-card">
                        <span className="label">Tempo</span>
                        <strong>{job.result.metrics.tempo}</strong>
                      </div>
                      <div className="summary-card">
                        <span className="label">Setup</span>
                        <strong>{job.result.metrics.setup}</strong>
                      </div>
                    </div>

                    <div className="analysis-feedback-list">
                      {job.result.feedback.map((feedbackItem) => (
                        <div key={feedbackItem} className="history-item">
                          <span>{feedbackItem}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="subtle-copy">
                    {job.status === "failed"
                      ? "This job failed. Check the backend logs and try again."
                      : "Analysis is still running for this video."}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
