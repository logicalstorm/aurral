import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { ChevronDown } from "lucide-react";

const STATUS_LABELS = {
  pass: "PASS",
  fail: "FAIL",
  warn: "WARN",
  skip: "SKIP",
};

function formatCheckedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function defaultExpandedBySection(sections) {
  const next = {};
  for (const section of sections) {
    if (section.status === "skip") {
      next[section.id] = false;
      continue;
    }
    next[section.id] = section.status !== "pass";
  }
  return next;
}

export function StorageHealthDashboard({ result, loading = false }) {
  const [expanded, setExpanded] = useState({});
  const sections = result?.sections;

  useEffect(() => {
    if (!sections?.length) return;
    setExpanded(defaultExpandedBySection(sections));
  }, [result?.checkedAt, sections]);

  if (!result?.sections?.length) {
    if (loading) {
      return (
        <div className="arr-health" role="status">
          <p className="arr-health__loading">Running storage checks…</p>
        </div>
      );
    }
    return null;
  }

  const activeSections = result.sections.filter((section) => section.status !== "skip");
  const summaryStatus = result.ok ? (result.partial ? "warn" : "pass") : "fail";
  const summaryLabel = result.ok ? (result.partial ? "Warnings" : "Healthy") : "Failed";
  const checkedAt = formatCheckedAt(result.checkedAt);

  const toggleSection = (sectionId) => {
    setExpanded((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  };

  return (
    <div className="arr-health" role="status">
      <div className={`arr-health__summary is-${summaryStatus}`}>
        <div className="arr-health__summary-main">
          <span className={`arr-health__badge arr-health__badge--${summaryStatus}`}>
            {summaryLabel}
          </span>
          <span className="arr-health__summary-text">
            {activeSections.length} sections checked
            {result.failedCount > 0 ? ` · ${result.failedCount} failed` : ""}
            {result.warningCount > 0
              ? ` · ${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
        {checkedAt ? (
          <span className="arr-health__summary-time">Last checked {checkedAt}</span>
        ) : null}
      </div>

      <div className="arr-health__table-wrap">
        <table className="arr-health__table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Check</th>
              <th scope="col">Detail</th>
              <th scope="col">Fix</th>
            </tr>
          </thead>
          <tbody>
            {result.sections.map((section) => {
              const isExpanded = expanded[section.id] === true;
              const isCollapsible = section.status !== "skip" && (section.steps?.length ?? 0) > 0;

              return (
                <SectionGroup
                  key={section.id}
                  section={section}
                  isExpanded={isExpanded}
                  isCollapsible={isCollapsible}
                  onToggle={() => toggleSection(section.id)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionGroup({ section, isExpanded, isCollapsible, onToggle }) {
  return (
    <>
      <tr
        className={`arr-health__section-row is-${section.status}${
          isCollapsible ? " is-collapsible" : ""
        }`}
      >
        <td colSpan={4}>
          {isCollapsible ? (
            <button
              type="button"
              className="arr-health__section-toggle"
              onClick={onToggle}
              aria-expanded={isExpanded}
            >
              <ChevronDown
                className={`arr-health__section-chevron${isExpanded ? "" : " is-collapsed"}`}
                aria-hidden
              />
              <span className={`arr-health__badge arr-health__badge--${section.status}`}>
                {STATUS_LABELS[section.status] || section.status}
              </span>
              <span className="arr-health__section-title">{section.title}</span>
            </button>
          ) : (
            <div className="arr-health__section-cell">
              <span className={`arr-health__badge arr-health__badge--${section.status}`}>
                {STATUS_LABELS[section.status] || section.status}
              </span>
              <span className="arr-health__section-title">{section.title}</span>
              {section.skipReason ? (
                <span className="arr-health__section-skip">{section.skipReason}</span>
              ) : null}
            </div>
          )}
        </td>
      </tr>
      {isExpanded
        ? (section.steps || []).map((step) => (
            <tr
              key={`${section.id}-${step.id}`}
              className={`arr-health__step-row is-${step.status}`}
            >
              <td>
                <span className={`arr-health__badge arr-health__badge--${step.status}`}>
                  {STATUS_LABELS[step.status] || step.status}
                </span>
              </td>
              <td className="arr-health__check">{step.label}</td>
              <td className="arr-health__detail">
                {step.detail ? (
                  <code className="arr-health__path">{step.detail}</code>
                ) : (
                  <span className="arr-health__muted">—</span>
                )}
              </td>
              <td className="arr-health__fix">
                {step.fix ? step.fix : <span className="arr-health__muted">—</span>}
              </td>
            </tr>
          ))
        : null}
    </>
  );
}

SectionGroup.propTypes = {
  isCollapsible: PropTypes.bool.isRequired,
  isExpanded: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  section: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    status: PropTypes.oneOf(["pass", "fail", "warn", "skip"]).isRequired,
    skipReason: PropTypes.string,
    steps: PropTypes.array,
  }).isRequired,
};

StorageHealthDashboard.propTypes = {
  loading: PropTypes.bool,
  result: PropTypes.shape({
    ok: PropTypes.bool,
    partial: PropTypes.bool,
    failedCount: PropTypes.number,
    warningCount: PropTypes.number,
    checkedAt: PropTypes.string,
    sections: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        status: PropTypes.oneOf(["pass", "fail", "warn", "skip"]).isRequired,
        skipReason: PropTypes.string,
        steps: PropTypes.arrayOf(
          PropTypes.shape({
            id: PropTypes.string.isRequired,
            status: PropTypes.oneOf(["pass", "fail", "warn"]).isRequired,
            label: PropTypes.string.isRequired,
            detail: PropTypes.string,
            fix: PropTypes.string,
          }),
        ),
      }),
    ),
  }),
};
