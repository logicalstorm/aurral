import { Navigate, useParams } from "react-router-dom";
import { buildActivityPath, DEFAULT_ACTIVITY_VIEW } from "../navigation/activityNavConfig";

export function LegacyHistoryRedirect() {
  return <Navigate to="/activity/history" replace />;
}

export function ActivitySourceRedirect() {
  const { view } = useParams();
  return <Navigate to={buildActivityPath(view)} replace />;
}

export function ActivityRootRedirect() {
  return <Navigate to={buildActivityPath(DEFAULT_ACTIVITY_VIEW)} replace />;
}
