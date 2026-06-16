export function SettingsModalSection({ title, children, className = "" }) {
  return (
    <section
      className={`settings-modal__section${className ? ` ${className}` : ""}`}
    >
      {title ? (
        <h4 className="settings-modal__section-title">{title}</h4>
      ) : null}
      <div className="settings-modal__section-body">{children}</div>
    </section>
  );
}

export function SettingsModalField({ label, htmlFor, hint, children }) {
  return (
    <div className="settings-modal__field">
      {label ? (
        <label className="settings-modal__label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="settings-modal__hint">{hint}</p> : null}
    </div>
  );
}

export function SettingsModalToggle({ label, ...inputProps }) {
  return (
    <label className="settings-modal__toggle">
      <input type="checkbox" className="artist-checkbox" {...inputProps} />
      <span className="settings-modal__toggle-label">{label}</span>
    </label>
  );
}

export function SettingsModalToggleGroup({ children }) {
  return <div className="settings-modal__toggle-group">{children}</div>;
}

export function SettingsModalIntro({ children }) {
  return <p className="settings-modal__intro">{children}</p>;
}

export function SettingsModalCallout({ children }) {
  return <div className="settings-modal__callout">{children}</div>;
}

export function SettingsModalActions({ children }) {
  return <div className="settings-modal__actions">{children}</div>;
}

export function SettingsModalMeta({ items }) {
  return (
    <dl className="settings-modal__meta">
      {items.map(({ term, value }) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
