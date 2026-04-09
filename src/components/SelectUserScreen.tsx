import { AuthenticatedUserSession } from "../types";

interface SelectUserScreenProps {
  authenticatedUsers: AuthenticatedUserSession[];
  onSelectUser: (sessionUserId: string) => void;
  onAddNewUser: () => void;
}

export function SelectUserScreen({
  authenticatedUsers,
  onSelectUser,
  onAddNewUser
}: SelectUserScreenProps) {
  return (
    <section className="screen">
      <div className="recording-banner">
        <div>
          <p className="eyebrow">Connected Users</p>
          <h1>Select who is recording next</h1>
          <p className="subtle-copy">
            Users can stay connected on this shared device, but only one person can own
            the next set.
          </p>
        </div>
        <div className="warning-card">
          <span className="label">Next step</span>
          <strong>Choose one user, then tap start recording</strong>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>{authenticatedUsers.length} users connected</h2>
          <button className="ghost-button" type="button" onClick={onAddNewUser}>
            Add New User
          </button>
        </div>
        <div className="selection-grid">
          {authenticatedUsers.map((user) => (
            <button
              key={user.sessionUserId}
              className="selection-card"
              type="button"
              onClick={() => onSelectUser(user.sessionUserId)}
            >
              <span className="selection-name">{user.userName}</span>
              <span className="subtle-copy">Tap to select for the next set</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
