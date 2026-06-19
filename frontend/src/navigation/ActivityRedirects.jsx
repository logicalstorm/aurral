import { Navigate, useParams } from "react-router-dom";
import {
  buildActivityPath,
  DEFAULT_ACTIVITY_SOURCE,
  DEFAULT_ACTIVITY_VIEW,
  resolveActivityPartialPath,
  resolveLegacyHistoryPath,
} from "../navigation/activityNavConfig";

export function LegacyHistoryRedirect() {
  const { legacyTab } = useParams();
  return <Navigate to={resolveLegacyHistoryPath(legacyTab)} replace />;
}

export function ActivityPartialRedirect() {
  const { view: segment } = useParams();
  return <Navigate to={resolveActivityPartialPath(segment)} replace />;
}

export function ActivityRootRedirect() {
  return (
    <Navigate
      to={buildActivityPath(DEFAULT_ACTIVITY_VIEW, DEFAULT_ACTIVITY_SOURCE)}
      replace
    />
  );
}
