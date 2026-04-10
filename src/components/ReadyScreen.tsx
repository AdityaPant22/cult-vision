import { useState } from "react";
import { ExercisePicker } from "./ExercisePicker";
import { AuthenticatedUserSession } from "../types";
import { SupportedExerciseId } from "../types";

interface ReadyScreenProps {
  activeUser: AuthenticatedUserSession;
  authenticatedUsers: AuthenticatedUserSession[];
  isBackendOnline: boolean;
  selectedExerciseId: SupportedExerciseId | null;
  onStartRecording: (weightKg: string) => void;
  onSelectConnectedUser: (sessionUserId: string) => void;
  onSelectExercise: (exerciseId: SupportedExerciseId) => void;
  onAddNewUser: () => void;
  onEndActiveUser: () => void;
}

export function ReadyScreen({
  activeUser,
  authenticatedUsers,
  isBackendOnline,
  selectedExerciseId,
  onStartRecording,
  onSelectConnectedUser,
  onSelectExercise,
  onAddNewUser,
  onEndActiveUser
}: ReadyScreenProps) {
  const [weightKg, setWeightKg] = useState("");
  return (
    <section className="screen">
      <div className="recording-banner">
        <div>
          <p className="eyebrow">Ready to Record</p>
          <h1>Recording as: {activeUser.userName}</h1>
          <p className="subtle-copy">Only this user owns the next recording.</p>
        </div>
        <div className="warning-card">
          <span className="label">Important</span>
          <strong>You are recording as {activeUser.userName}</strong>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Connected users</h2>
          <span>Only one can be selected</span>
        </div>
        <p className="subtle-copy">
          {authenticatedUsers.length} authenticated on device. Tap a different user any
          time to switch the next recording owner.
        </p>
        <div className="single-select-list" role="listbox" aria-label="Connected users">
          {authenticatedUsers.map((user) => (
            <button
              key={user.sessionUserId}
              className={`single-select-option ${user.isActive ? "active" : ""}`}
              type="button"
              aria-selected={user.isActive}
              onClick={() => onSelectConnectedUser(user.sessionUserId)}
            >
              <span className={`radio-indicator ${user.isActive ? "active" : ""}`} />
              <span className="single-select-copy">
                <strong>{user.userName}</strong>
                <small>{user.isActive ? "Selected for the next recording" : "Tap to switch selection"}</small>
              </span>
              <span className="single-select-state">
                {user.isActive ? "Selected" : "Available"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Select exercise for the next set</h2>
          </div>
          <span>Required before recording</span>
        </div>
        <p className="subtle-copy">
          Pick what {activeUser.userName} is about to do so the live guidance stays locked to
          that movement.
        </p>
        <ExercisePicker
          selectedExerciseId={selectedExerciseId}
          onSelectExercise={onSelectExercise}
        />
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>Weight lifted</h2>
          </div>
          <span>Optional</span>
        </div>
        <p className="subtle-copy">
          Enter the weight {activeUser.userName} is lifting so we can personalize the feedback.
        </p>
        <div className="inline-form">
          <input
            inputMode="numeric"
            type="text"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="80"
          />
          <span className="input-suffix-chip">kg</span>
        </div>
      </div>

      {!isBackendOnline ? (
        <div className="backend-status-banner">
          <strong>Backend offline</strong>
          <span>Start with `npm start` or run `npm run api:dev` to enable recording.</span>
        </div>
      ) : null}

      <div className="action-grid">
        <button
          className="primary-button tall-button"
          type="button"
          onClick={() => onStartRecording(weightKg.trim())}
          disabled={!isBackendOnline || !selectedExerciseId}
        >
          {selectedExerciseId ? "Start Recording" : "Select Exercise First"}
        </button>
        <button className="secondary-button tall-button" type="button" onClick={onAddNewUser}>
          Add New User
        </button>
        <button className="ghost-button tall-button" type="button" onClick={onEndActiveUser}>
          End for {activeUser.userName}
        </button>
      </div>
    </section>
  );
}
