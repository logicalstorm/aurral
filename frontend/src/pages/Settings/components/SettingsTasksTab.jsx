import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { getSettingsTasks } from "../../../utils/api";
import { SettingsArrFieldSet } from "./arr/SettingsArrLayout";

const POLL_INTERVAL_MS = 5000;

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

const STATUS_META = {
  completed: {
    label: "Completed",
    tone: "ok",
    icon: Check,
  },
  failed: {
    label: "Failed",
    tone: "danger",
    icon: XCircle,
  },
  running: {
    label: "Running",
    tone: "active",
    icon: Loader2,
  },
  queued: {
    label: "Queued",
    tone: "queued",
    icon: Clock,
  },
  scheduled: {
    label: "Scheduled",
    tone: "queued",
    icon: Clock,
  },
  idle: {
    label: "Idle",
    tone: "muted",
    icon: Check,
  },
  not_loaded: {
    label: "Standby",
    tone: "muted",
    icon: AlertCircle,
  },
};

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatRelative(value, empty = "Never") {
  const date = parseDate(value);
  if (!date) return empty;
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const [unit, seconds] =
    units.find(([, unitSeconds]) => Math.abs(diffSeconds) >= unitSeconds) ||
    units[units.length - 1];
  return relativeFormatter.format(Math.round(diffSeconds / seconds), unit);
}

function formatDuration(ms) {
  if (ms == null || ms === "") return "—";
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "—";
  const totalSeconds = Math.floor(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function formatCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) ? count : 0;
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || {
    label: status || "Unknown",
    tone: "muted",
    icon: AlertCircle,
  };
  const Icon = meta.icon;
  return (
    <span className={`arr-task-status arr-task-status--${meta.tone}`}>
      <Icon
        className={`arr-task-status__icon${
          status === "running" ? " animate-spin" : ""
        }`}
        aria-hidden
      />
      {meta.label}
    </span>
  );
}

function EmptyRows({ colSpan }) {
  return (
    <tr className="arr-table__empty-row">
      <td colSpan={colSpan}>No task data available.</td>
    </tr>
  );
}

function ScheduledTable({ scheduled = [] }) {
  return (
    <div className="arr-table-wrap">
      <table className="arr-table arr-table--tasks">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Interval</th>
            <th scope="col">Last Execution</th>
            <th scope="col">Last Duration</th>
            <th scope="col">Next Execution</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {scheduled.length === 0 ? (
            <EmptyRows colSpan={6} />
          ) : (
            scheduled.map((task) => (
              <tr key={task.id || task.scheduleName || task.name}>
                <td>
                  <span className="arr-table__primary">{task.name}</span>
                  {task.description ? (
                    <span className="arr-table__subtle">
                      {task.description}
                    </span>
                  ) : null}
                </td>
                <td>{task.interval || task.schedule || "—"}</td>
                <td>{formatRelative(task.lastExecutionAt)}</td>
                <td>{formatDuration(task.lastDurationMs)}</td>
                <td>{formatRelative(task.nextExecutionAt, "Not scheduled")}</td>
                <td>
                  {task.lastStatus ? (
                    <StatusBadge status={task.lastStatus} />
                  ) : (
                    <span className="arr-table__subtle">No runs yet</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function WorkersTable({ workers = [] }) {
  return (
    <div className="arr-table-wrap">
      <table className="arr-table arr-table--tasks">
        <thead>
          <tr>
            <th scope="col">Worker</th>
            <th scope="col">Status</th>
            <th scope="col">Active</th>
            <th scope="col">Queued</th>
            <th scope="col">Scheduled</th>
            <th scope="col">Failed</th>
            <th scope="col">Last Run</th>
          </tr>
        </thead>
        <tbody>
          {workers.length === 0 ? (
            <EmptyRows colSpan={7} />
          ) : (
            workers.map((worker) => (
              <tr key={worker.queue}>
                <td>
                  <span className="arr-table__primary">
                    {worker.name || worker.queueLabel}
                  </span>
                  {worker.description ? (
                    <span className="arr-table__subtle">
                      {worker.description}
                    </span>
                  ) : null}
                </td>
                <td>
                  <StatusBadge status={worker.status} />
                </td>
                <td>{formatCount(worker.processing)}</td>
                <td>{formatCount(worker.queued)}</td>
                <td>{formatCount(worker.scheduled)}</td>
                <td>
                  <span
                    className={
                      formatCount(worker.failed) > 0
                        ? "arr-task-count arr-task-count--danger"
                        : "arr-task-count"
                    }
                  >
                    {formatCount(worker.failed)}
                  </span>
                </td>
                <td>{formatRelative(worker.lastRunAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function QueueTable({ queue = [] }) {
  return (
    <div className="arr-table-wrap">
      <table className="arr-table arr-table--tasks arr-table--task-queue">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Status</th>
            <th scope="col">Queued</th>
            <th scope="col">Started</th>
            <th scope="col">Ended</th>
            <th scope="col">Duration</th>
            <th scope="col">Attempt</th>
          </tr>
        </thead>
        <tbody>
          {queue.length === 0 ? (
            <EmptyRows colSpan={7} />
          ) : (
            queue.map((task) => (
              <tr key={task.id}>
                <td>
                  <span className="arr-table__primary">{task.name}</span>
                  {task.description || task.payloadSummary ? (
                    <span className="arr-table__subtle">
                      {task.description || task.payloadSummary}
                    </span>
                  ) : null}
                  {task.error ? (
                    <span className="arr-table__subtle arr-table__subtle--danger">
                      {task.error}
                    </span>
                  ) : null}
                  {Number(task.duplicateCount || 1) > 1 ? (
                    <span className="arr-table__subtle">
                      {task.duplicateCount}{" "}
                      {task.status === "scheduled"
                        ? "delayed copies"
                        : "recent runs"}{" "}
                      grouped
                    </span>
                  ) : null}
                </td>
                <td>
                  <StatusBadge status={task.status} />
                </td>
                <td>{formatRelative(task.queuedAt, "—")}</td>
                <td>
                  {task.startedAt
                    ? formatRelative(task.startedAt)
                    : formatRelative(task.runAt, "—")}
                </td>
                <td>{formatRelative(task.endedAt, "—")}</td>
                <td>{formatDuration(task.durationMs)}</td>
                <td>
                  {task.maxAttempts
                    ? `${formatCount(task.attempt)} / ${formatCount(
                        task.maxAttempts,
                      )}`
                    : formatCount(task.attempt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SettingsTasksTab({ showError }) {
  const [tasks, setTasks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refreshTasks = useCallback(
    async ({ notify = false } = {}) => {
      setRefreshing(true);
      try {
        const result = await getSettingsTasks();
        setTasks(result);
      } catch (error) {
        if (notify) {
          showError(
            error.response?.data?.message ||
              error.response?.data?.error ||
              error.message ||
              "Failed to load tasks",
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showError],
  );

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await refreshTasks();
    };
    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [refreshTasks]);

  return (
    <div className="arr-page">
      <SettingsArrFieldSet
        legend="Scheduled"
        actions={
          <button
            type="button"
            className="arr-btn"
            onClick={() => refreshTasks({ notify: true })}
            disabled={refreshing}
          >
            <RefreshCw
              className={`artist-icon-sm${refreshing ? " animate-spin" : ""}`}
              aria-hidden
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        }
      >
        <ScheduledTable scheduled={tasks?.scheduled || []} />
      </SettingsArrFieldSet>

      <SettingsArrFieldSet legend="Workers">
        <WorkersTable workers={tasks?.workers || []} />
      </SettingsArrFieldSet>

      <SettingsArrFieldSet legend="Queue">
        {loading ? (
          <p className="arr-form-help">Loading tasks…</p>
        ) : (
          <QueueTable queue={tasks?.queue || []} />
        )}
      </SettingsArrFieldSet>
    </div>
  );
}
