import { ExercisePicker } from "./ExercisePicker";
import { formatDuration } from "../shared/lib/format";
import { AuthenticatedUserSession, Recording, RecordingLibraryItem } from "../types";
import { SupportedExerciseId } from "../types";

interface PostRecordingScreenProps {
  activeUser: AuthenticatedUserSession | null;
  latestRecording: Recording;
  latestRecordingItem: RecordingLibraryItem | null;
  otherUsers: AuthenticatedUserSession[];
  isBackendOnline: boolean;
  selectedExerciseId: SupportedExerciseId | null;
  onRecordNextSet: () => void;
  onEndActiveUser: () => void;
  onAddNewUser: () => void;
  onSelectExercise: (exerciseId: SupportedExerciseId) => void;
  onOpenTemplates: () => void;
  onSwitchUser: (sessionUserId: string) => void;
  isTemplateProcessing: boolean;
}

export function PostRecordingScreen({
  activeUser,
  latestRecording,
  latestRecordingItem,
  otherUsers,
  isBackendOnline,
  selectedExerciseId,
  onRecordNextSet,
  onEndActiveUser,
  onAddNewUser,
  onSelectExercise,
  onOpenTemplates,
  onSwitchUser,
  isTemplateProcessing
}: PostRecordingScreenProps) {
  return (
    <section className="screen">
      <div className="panel panel-large">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Set Captured</p>
            <h1>{latestRecording.userName}</h1>
          </div>
          <span className={`status-pill ${latestRecording.status}`}>
            {latestRecording.status === "uploading" ? "Uploading..." : latestRecording.status}
          </span>
        </div>

        <div className="summary-grid">
          <div className="summary-card">
            <span className="label">Duration</span>
            <strong>{formatDuration(latestRecording.durationSec)}</strong>
          </div>
          <div className="summary-card">
            <span className="label">Stopped at</span>
            <strong>
              {latestRecording.stoppedAt
                ? new Date(latestRecording.stoppedAt).toLocaleTimeString()
                : "Still recording"}
            </strong>
          </div>
          <div className="summary-card">
            <span className="label">Next owner</span>
            <strong>{activeUser?.userName ?? "No active user"}</strong>
          </div>
        </div>
      </div>

      {!isBackendOnline ? (
        <div className="backend-status-banner">
          <strong>Backend offline</strong>
          <span>Recording is paused until the analysis backend is started again.</span>
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Select exercise for the next set</h2>
          </div>
          <span>Choose again every set</span>
        </div>
        <p className="subtle-copy">
          The next recording stays guided to exactly one exercise. Pick it before recording
          again.
        </p>
        <ExercisePicker
          selectedExerciseId={selectedExerciseId}
          onSelectExercise={onSelectExercise}
        />
      </div>

      <div className="action-grid action-grid-four">
        <button
          className="primary-button tall-button"
          type="button"
          onClick={onRecordNextSet}
          disabled={!isBackendOnline || !selectedExerciseId}
        >
          {selectedExerciseId ? "Record Next Set" : "Select Exercise First"}
        </button>
        <button className="secondary-button tall-button" type="button" onClick={onAddNewUser}>
          Add New User
        </button>
        <button className="ghost-button tall-button" type="button" onClick={onOpenTemplates}>
          {latestRecordingItem?.editedVersion ? "View Templates Again" : "View Templates"}
        </button>
        <button className="ghost-button tall-button" type="button" onClick={onEndActiveUser}>
          End
        </button>
      </div>

      {isTemplateProcessing || latestRecordingItem?.editedVersion ? (
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Edited Clip</p>
              <h2>
                {latestRecordingItem?.editedVersion?.templateName ?? "Rendering template..."}
              </h2>
            </div>
            {latestRecordingItem?.editedVersion ? (
              <a
                className="secondary-button"
                href={latestRecordingItem.editedVersion.playbackUrl}
                download={`${latestRecording.userName.toLowerCase().replace(/\s+/g, "-")}-${latestRecordingItem.editedVersion.templateId}.webm`}
              >
                Download Edit
              </a>
            ) : null}
          </div>

          {latestRecordingItem?.editedVersion ? (
            <video
              className="recording-video"
              controls
              playsInline
              preload="metadata"
              src={latestRecordingItem.editedVersion.playbackUrl}
            />
          ) : (
            <div className="template-inline-status">
              <strong>Applying the selected gym template...</strong>
              <p className="subtle-copy">
                We are turning this raw set into a polished, shareable gym clip.
              </p>
            </div>
          )}
        </div>
      ) : null}

      <div className="panel">
        <div className="panel-header">
          <h2>Switch next recording to another user</h2>
          <span>Explicit handoff only</span>
        </div>
        {otherUsers.length === 0 ? (
          <p className="subtle-copy">No other authenticated users on this device.</p>
        ) : (
          <div className="chip-row chip-row-large">
            {otherUsers.map((user) => (
              <button
                key={user.sessionUserId}
                className="user-chip"
                type="button"
                onClick={() => onSwitchUser(user.sessionUserId)}
              >
                Select {user.userName}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
