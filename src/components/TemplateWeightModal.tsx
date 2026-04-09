import { FormEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";

interface TemplateWeightModalProps {
  open: boolean;
  templateName: string;
  onClose: () => void;
  onSubmitWeight: (weightKg: string) => void;
}

export function TemplateWeightModal({
  open,
  templateName,
  onClose,
  onSubmitWeight
}: TemplateWeightModalProps) {
  const [weightKg, setWeightKg] = useState("");

  useEffect(() => {
    if (!open) {
      setWeightKg("");
    }
  }, [open]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextWeightKg = weightKg.trim();
    if (!nextWeightKg) {
      return;
    }

    onSubmitWeight(nextWeightKg);
  };

  return (
    <Modal open={open} title="Add Lifted Weight" onClose={onClose}>
      <p className="modal-copy">
        Enter the lifted weight for <strong>{templateName}</strong>. We will use this number as
        kilograms automatically in the exported video.
      </p>

      <form className="phone-form" onSubmit={handleSubmit}>
        <label htmlFor="template-weight-input">Weight lifted</label>
        <div className="inline-form">
          <input
            id="template-weight-input"
            inputMode="numeric"
            autoFocus
            type="text"
            value={weightKg}
            onChange={(event) =>
              setWeightKg(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
            placeholder="80"
          />
          <span className="input-suffix-chip">kg</span>
          <button className="primary-button" type="submit" disabled={!weightKg.trim()}>
            Start Render
          </button>
        </div>
        <p className="subtle-copy">Only enter the number. Example: <code>80</code>.</p>
      </form>
    </Modal>
  );
}
