import { useEffect, useRef, useState } from "react";

interface UseInactivityTimeoutProps {
  enabled: boolean;
  isRecording: boolean;
  hasAuthenticatedUsers: boolean;
  idleTimeoutSec: number;
  warningCountdownSec: number;
  warningStartedAt: string | null;
  onShowWarning: () => void;
  onHideWarning: () => void;
  onReset: () => void;
}

export function useInactivityTimeout({
  enabled,
  isRecording,
  hasAuthenticatedUsers,
  idleTimeoutSec,
  warningCountdownSec,
  warningStartedAt,
  onShowWarning,
  onHideWarning,
  onReset
}: UseInactivityTimeoutProps) {
  const lastActivityRef = useRef(Date.now());
  const [remainingWarningSec, setRemainingWarningSec] = useState(warningCountdownSec);

  useEffect(() => {
    const markActivity = () => {
      lastActivityRef.current = Date.now();

      if (warningStartedAt) {
        onHideWarning();
      }
    };

    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
      "mousemove"
    ];

    events.forEach((eventName) =>
      window.addEventListener(eventName, markActivity, { passive: true })
    );

    return () => {
      events.forEach((eventName) =>
        window.removeEventListener(eventName, markActivity)
      );
    };
  }, [onHideWarning, warningStartedAt]);

  useEffect(() => {
    if (!enabled || isRecording || !hasAuthenticatedUsers || warningStartedAt) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const inactiveForMs = Date.now() - lastActivityRef.current;
      if (inactiveForMs >= idleTimeoutSec * 1000) {
        onShowWarning();
      }
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    enabled,
    hasAuthenticatedUsers,
    idleTimeoutSec,
    isRecording,
    onShowWarning,
    warningStartedAt
  ]);

  useEffect(() => {
    if (!warningStartedAt) {
      setRemainingWarningSec(warningCountdownSec);
      return;
    }

    const warningStartMs = new Date(warningStartedAt).getTime();

    const updateCountdown = () => {
      const elapsedSec = Math.floor((Date.now() - warningStartMs) / 1000);
      const nextRemaining = Math.max(warningCountdownSec - elapsedSec, 0);
      setRemainingWarningSec(nextRemaining);

      if (nextRemaining <= 0) {
        onReset();
      }
    };

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [onReset, warningCountdownSec, warningStartedAt]);

  return {
    remainingWarningSec
  };
}
