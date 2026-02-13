import PropTypes from "prop-types";
import "./PillToggle.css";

function PillToggle({ checked, onChange, disabled, id }) {
  const inputId = id || `pill-toggle-${Math.random().toString(36).slice(2)}`;
  return (
    <div className="pill-toggle">
      <input
        type="checkbox"
        id={inputId}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <label htmlFor={inputId} />
    </div>
  );
}

PillToggle.propTypes = {
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  id: PropTypes.string,
};

export default PillToggle;
