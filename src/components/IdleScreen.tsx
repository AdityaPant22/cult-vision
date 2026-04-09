import { FormEvent, useState } from "react";
import { AuthenticatedUserSession } from "../types";

interface IdleScreenProps {
  deviceName: string;
  zoneName: string;
  authenticatedUsers: AuthenticatedUserSession[];
  activeUser: AuthenticatedUserSession | null;
  onSubmitPhone: (phone: string) => void;
}

export function IdleScreen({
  deviceName,
  zoneName,
  authenticatedUsers,
  activeUser,
  onSubmitPhone
}: IdleScreenProps) {
  const [phone, setPhone] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!phone.trim()) {
      return;
    }

    onSubmitPhone(phone);
    setPhone("");
  };

  return (
    <section className="screen screen-idle">
      <div className="device-header">
        <p className="eyebrow">Cult Vision Kiosk</p>
        <h1>{zoneName}</h1>
        <p className="subtle-copy">{deviceName} • Shared recording device</p>
      </div>

      <div className="hero-panel">
        <div className="phone-auth-card" aria-label="Phone authentication placeholder">
          <span className="phone-auth-icon">123</span>
        </div>

        <div className="hero-copy">
          <span className="pill">Shared Device</span>
          <h2>Enter phone number to connect</h2>
          <p>
            Multiple members can stay signed in here. Only one active user records at
            a time.
          </p>
          <form className="phone-form" onSubmit={handleSubmit}>
            <div className="inline-form">
              <input
                aria-label="Phone number"
                inputMode="numeric"
                type="text"
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value.replace(/\D/g, "").slice(0, 15))
                }
                placeholder="Enter any digits"
              />
              <button className="primary-button" type="submit">
                Continue
              </button>
            </div>
            <p className="subtle-copy">
              Prototype mode: any digits will authenticate a user.
            </p>
          </form>
        </div>
      </div>

      <div className="status-strip">
        <div className="status-card">
          <span className="label">Authenticated users</span>
          {authenticatedUsers.length === 0 ? (
            <strong>None connected yet</strong>
          ) : (
            <div className="chip-row">
              {authenticatedUsers.map((user) => (
                <span key={user.sessionUserId} className="chip">
                  {user.userName}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="status-card">
          <span className="label">Current active user</span>
          <strong>{activeUser?.userName ?? "Waiting for connection"}</strong>
        </div>
      </div>
    </section>
  );
}
