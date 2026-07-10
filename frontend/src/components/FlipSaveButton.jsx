import { Save } from "lucide-react";

function FlipSaveButton({ disabled, saving, onClick, label = "Save" }) {
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={disabled || saving}
      onClick={onClick}
    >
      <Save aria-hidden="true" />
      {label}
    </button>
  );
}

export default FlipSaveButton;
