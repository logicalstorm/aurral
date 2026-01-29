import PropTypes from "prop-types";
import "./PowerSwitch.css";

function PowerSwitch({ checked, onChange, disabled }) {
  return (
    <div className="power-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <div className="button">
        <svg className="power-off" viewBox="0 0 150 150">
          <line x1="75" y1="34" x2="75" y2="58" className="line" />
          <circle cx="75" cy="80" r="35" className="circle" />
        </svg>
        <svg className="power-on" viewBox="0 0 150 150">
          <line x1="75" y1="34" x2="75" y2="58" className="line" />
          <circle cx="75" cy="80" r="35" className="circle" />
        </svg>
      </div>
    </div>
  );
}

PowerSwitch.propTypes = {
  checked: PropTypes.bool.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

export default PowerSwitch;
