import { AuthenticatedUserSession } from "../types";
import { Modal } from "./Modal";

interface UserSwitcherModalProps {
  open: boolean;
  authenticatedUsers: AuthenticatedUserSession[];
  activeUserId: string | null;
  onClose: () => void;
  onSelectUser: (sessionUserId: string) => void;
  onAddNewUser: () => void;
}

export function UserSwitcherModal({
  open,
  authenticatedUsers,
  activeUserId,
  onClose,
  onSelectUser,
  onAddNewUser
}: UserSwitcherModalProps) {
  return (
    <Modal open={open} title="Change User" onClose={onClose}>
      <p className="modal-copy">
        Choose from the connected users on this device, or add someone new from the
        resting group.
      </p>

      <div className="panel panel-embedded">
        <div className="panel-header">
          <h2>Connected users</h2>
          <span>{authenticatedUsers.length} on device</span>
        </div>
        <div className="auth-grid">
          {authenticatedUsers.map((user) => (
            <button
              key={user.sessionUserId}
              className={`user-option ${user.sessionUserId === activeUserId ? "is-authenticated" : ""}`}
              type="button"
              onClick={() => onSelectUser(user.sessionUserId)}
            >
              <span className="avatar avatar-neutral" aria-hidden="true">
                {user.userName.charAt(0).toUpperCase()}
              </span>
              <span>
                <strong>{user.userName}</strong>
                <small>
                  {user.sessionUserId === activeUserId
                    ? "Currently selected"
                    : "Choose for the next set"}
                </small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <button className="secondary-button" type="button" onClick={onAddNewUser}>
        Add New User
      </button>
    </Modal>
  );
}
