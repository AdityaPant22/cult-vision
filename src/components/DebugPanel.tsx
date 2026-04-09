import { AppState, Recording } from "../types";

interface DebugPanelProps {
  open: boolean;
  state: AppState;
  remainingWarningSec: number;
  onClose: () => void;
  onToggleTimeout: (enabled: boolean) => void;
  onResetDevice: () => void;
}

function groupRecordingsByUser(recordings: Recording[]) {
  return recordings.reduce<Record<string, Recording[]>>((groups, recording) => {
    const key = recording.userName;
    groups[key] = groups[key] ? [...groups[key], recording] : [recording];
    return groups;
  }, {});
}

export function DebugPanel({
  open,
  state,
  remainingWarningSec,
  onClose,
  onToggleTimeout,
  onResetDevice
}: DebugPanelProps) {
  const recordingGroups = groupRecordingsByUser(state.deviceSession.recordings);

  return (
    <aside className={`debug-panel ${open ? "open" : ""}`}>
      <div className="debug-header">
        <div>
          <p className="eyebrow">Debug Panel</p>
          <h2>Session State</h2>
        </div>
        <button className="ghost-button" onClick={onClose} type="button">
          Close
        </button>
      </div>

      <div className="debug-section">
        <label className="toggle-row">
          <span>Inactivity timeout</span>
          <input
            type="checkbox"
            checked={state.inactivity.enabled}
            onChange={(event) => onToggleTimeout(event.target.checked)}
          />
        </label>
        <p className="subtle-copy">
          60s idle warning with {state.inactivity.warningCountdownSec}s reset countdown.
        </p>
        {state.inactivity.warningStartedAt ? (
          <div className="warning-inline">Resetting in {remainingWarningSec}s</div>
        ) : null}
      </div>

      <div className="debug-section">
        <div className="panel-header">
          <h3>Recording history</h3>
          <button className="ghost-button" type="button" onClick={onResetDevice}>
            End All / Reset Device
          </button>
        </div>
        {Object.keys(recordingGroups).length === 0 ? (
          <p className="subtle-copy">No recordings yet.</p>
        ) : (
          <div className="history-groups">
            {Object.entries(recordingGroups).map(([userName, recordings]) => (
              <div key={userName} className="history-group">
                <strong>{userName}</strong>
                {recordings
                  .slice()
                  .reverse()
                  .map((recording) => (
                    <div key={recording.id} className="history-item">
                      <span>{new Date(recording.startedAt).toLocaleTimeString()}</span>
                      <span>{recording.durationSec}s</span>
                      <span>{recording.status}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="debug-section">
        <h3>Raw state</h3>
        <pre className="code-block">{JSON.stringify(state, null, 2)}</pre>
      </div>
    </aside>
  );
}
