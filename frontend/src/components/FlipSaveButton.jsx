import { Save } from "lucide-react";
import PropTypes from "prop-types";
import "./FlipSaveButton.css";

function FlipSaveButton({ disabled, saving, onClick }) {
  const handleClick = (e) => {
    if (disabled || saving) return;
    onClick(e);
  };

  return (
    <div className={`btn-flip-wrap${disabled ? " flipped" : ""}`}>
      <button
        type="button"
        className="btn-flip"
        disabled={disabled || saving}
        onClick={handleClick}
      >
        <div className="btn-flip-inner">
          <span className="btn-flip-front">
            <Save className="w-4 h-4" />
            Save
          </span>
          <span className="btn-flip-back">
            <Save className="w-4 h-4" />
            Saved
          </span>
        </div>
      </button>
    </div>
  );
}

FlipSaveButton.propTypes = {
  disabled: PropTypes.bool,
  saving: PropTypes.bool,
  onClick: PropTypes.func.isRequired,
};

export default FlipSaveButton;
