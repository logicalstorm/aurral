import "./PillToggle.css";

function PillToggle({ checked, onChange, disabled, id, className }) {
  const inputId = id || `pill-toggle-${Math.random().toString(36).slice(2)}`;
  return (
    <div className={`pill-toggle ${className || ""}`.trim()}>
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

export default PillToggle;
