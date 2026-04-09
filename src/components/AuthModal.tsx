import { FormEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";

interface AuthModalProps {
  open: boolean;
  mode: "scan" | "add";
  onClose: () => void;
  onSubmitPhone: (phone: string) => void;
}

export function AuthModal({
  open,
  mode,
  onClose,
  onSubmitPhone
}: AuthModalProps) {
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!open) {
      setPhone("");
    }
  }, [open]);

  const title = mode === "scan" ? "Enter Phone Number" : "Add New User";

  const description =
    mode === "scan"
      ? "Authenticate the next member on this shared device by entering their phone number."
      : "Add another member to this shared device by entering any phone number.";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!phone.trim()) {
      return;
    }

    onSubmitPhone(phone);
  };

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="modal-copy">{description}</p>

      <form className="phone-form" onSubmit={handleSubmit}>
        <label htmlFor="phone-number-input">Phone number</label>
        <div className="inline-form">
          <input
            id="phone-number-input"
            inputMode="numeric"
            autoFocus
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
    </Modal>
  );
}
