import { useState } from "react";
import { AuthenticatedUserSession } from "../types";

interface TermsScreenProps {
  user: AuthenticatedUserSession;
  onProceed: () => void;
}

export function TermsScreen({ user, onProceed }: TermsScreenProps) {
  const [showMore, setShowMore] = useState(false);

  return (
    <section className="screen terms-screen">
      <div className="terms-card">
        <div>
          <p className="eyebrow">Terms and Conditions</p>
          <h1>{user.userName}</h1>
          <p className="subtle-copy">
            Before joining this device session, please review these prototype terms.
          </p>
        </div>

        <div className="terms-copy">
          <p>
            Recordings may include your workout form, face, and gym surroundings.
            These clips are intended for your own set review and coaching feedback.
          </p>
          <p>
            Do not use this device to capture anyone without consent. Shared-device
            sessions can be ended by the member at any time.
          </p>
          <p>
            By proceeding, you confirm that you understand this is a prototype and
            agree to the kiosk recording terms for this session.
          </p>
        </div>

        {showMore ? (
          <div className="terms-more">
            <strong>Learn more in the app</strong>
            <p className="subtle-copy">
              In production, this would open the full recording policy, privacy
              details, and consent controls inside the member app.
            </p>
          </div>
        ) : null}

        <div className="terms-actions">
          <button className="primary-button tall-button" type="button" onClick={onProceed}>
            Proceed
          </button>
          <button
            className="ghost-button tall-button"
            type="button"
            onClick={() => setShowMore((current) => !current)}
          >
            Learn More About The T&C On The App
          </button>
        </div>

        <p className="subtle-copy">
          By clicking proceed, you agree to the T&C for kiosk recording on this
          device.
        </p>
      </div>
    </section>
  );
}
