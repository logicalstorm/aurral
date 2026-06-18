import PropTypes from "prop-types";

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

function buildRows(sections) {
  const rows = [];
  for (const section of sections) {
    rows.push({ kind: "section", section });
    if (section.status === "skip") continue;
    for (const step of section.steps || []) {
      rows.push({ kind: "step", section, step });
    }
  }
  return rows;
}

export function StorageHealthDashboard({ result, loading = false }) {
  if (loading) {
    return (
      <div className="storage-health" role="status">
        <p className="storage-health__loading">Running storage checks…</p>
      </div>
    );
  }

  if (!result?.sections?.length) return null;

  const activeSections = result.sections.filter(
    (section) => section.status !== "skip",
  );
  const summaryStatus = result.ok
    ? result.partial
      ? "warn"
      : "pass"
    : "fail";
  const summaryLabel = result.ok
    ? result.partial
      ? "Warnings"
      : "Healthy"
    : "Failed";
  const checkedAt = formatCheckedAt(result.checkedAt);
  const rows = buildRows(result.sections);

  return (
    <div className="storage-health" role="status">
      <div className={`storage-health__summary is-${summaryStatus}`}>
        <div className="storage-health__summary-main">
          <span
            className={`storage-health__badge storage-health__badge--${summaryStatus}`}
          >
            {summaryLabel}
          </span>
          <span className="storage-health__summary-text">
            {activeSections.length} sections checked
            {result.failedCount > 0 ? ` · ${result.failedCount} failed` : ""}
            {result.warningCount > 0
              ? ` · ${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}`
              : ""}
          </span>
        </div>
        {checkedAt ? (
          <span className="storage-health__summary-time">Last checked {checkedAt}</span>
        ) : null}
      </div>

      <div className="storage-health__table-wrap">
        <table className="storage-health__table">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Check</th>
              <th scope="col">Detail</th>
              <th scope="col">Fix</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              if (row.kind === "section") {
                const { section } = row;
                return (
                  <tr
                    key={`section-${section.id}`}
                    className={`storage-health__section-row is-${section.status}`}
                  >
                    <td colSpan={4}>
                      <div className="storage-health__section-cell">
                        <span
                          className={`storage-health__badge storage-health__badge--${section.status}`}
                        >
                          {STATUS_LABELS[section.status] || section.status}
                        </span>
                        <span className="storage-health__section-title">
                          {section.title}
                        </span>
                        {section.skipReason ? (
                          <span className="storage-health__section-skip">
                            {section.skipReason}
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              }

              const { section, step } = row;
              return (
                <tr
                  key={`${section.id}-${step.id}`}
                  className={`storage-health__step-row is-${step.status}`}
                >
                  <td>
                    <span
                      className={`storage-health__badge storage-health__badge--${step.status}`}
                    >
                      {STATUS_LABELS[step.status] || step.status}
                    </span>
                  </td>
                  <td className="storage-health__check">{step.label}</td>
                  <td className="storage-health__detail">
                    {step.detail ? (
                      <code className="storage-health__path">{step.detail}</code>
                    ) : (
                      <span className="storage-health__muted">—</span>
                    )}
                  </td>
                  <td className="storage-health__fix">
                    {step.fix ? step.fix : <span className="storage-health__muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
