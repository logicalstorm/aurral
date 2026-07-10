export function SettingsArrFieldSet({ legend, actions = null, children }) {
  return (
    <fieldset className="arr-fieldset">
      <div className="arr-fieldset__head">
        <legend className="arr-fieldset__legend">{legend}</legend>
        {actions ? <div className="arr-fieldset__actions">{actions}</div> : null}
      </div>
      <div className="arr-fieldset__body">{children}</div>
    </fieldset>
  );
}

export function SettingsArrFormGroup({
  label,
  labelFor,
  help,
  helpWarning = false,
  size = "small",
  children,
}) {
  return (
    <div className={`arr-form-group arr-form-group--${size}`}>
      <label className="arr-form-label" htmlFor={labelFor}>
        {label}
      </label>
      <div className="arr-form-control">
        {children}
        {help ? (
          <p className={`arr-form-help${helpWarning ? " arr-form-help--warning" : ""}`}>{help}</p>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsArrCardGrid({ children }) {
  return <div className="arr-card-grid">{children}</div>;
}

export function SettingsArrCard({ title, subtitle, meta, status, onClick }) {
  return (
    <button type="button" className="arr-card" onClick={onClick}>
      <span className="arr-card__main">
        <span className="arr-card__title">{title}</span>
        {subtitle ? <span className="arr-card__subtitle">{subtitle}</span> : null}
        {meta ? <span className="arr-card__meta">{meta}</span> : null}
      </span>
      {status ? (
        <span className={`arr-card__status arr-card__status--${status.tone}`}>{status.label}</span>
      ) : null}
    </button>
  );
}
