import { useNavigate } from "react-router-dom";
import { SettingsSelect } from "../pages/Settings/components/SettingsField";

export function PageSectionMobileNav({
  basePath,
  sections,
  activeId,
  label = "View",
}) {
  const navigate = useNavigate();

  return (
    <div className="page-section-mobile-nav">
      <label htmlFor="page-section-select" className="page-section-mobile-nav__label">
        {label}
      </label>
      <SettingsSelect
        legacyStyle
        id="page-section-select"
        value={activeId}
        onChange={(event) =>
          navigate(`${basePath}/${event.target.value}`)
        }
      >
        {sections.map((section) => (
          <option key={section.id} value={section.id}>
            {section.label}
          </option>
        ))}
      </SettingsSelect>
    </div>
  );
}
