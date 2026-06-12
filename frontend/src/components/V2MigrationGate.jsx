import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { getBootstrapStatus } from "../utils/api";
import V2MigrationModal from "./V2MigrationModal";

export default function V2MigrationGate({ children }) {
  const [loading, setLoading] = useState(true);
  const [migration, setMigration] = useState(null);
  const [appVersion, setAppVersion] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      const bootstrap = await getBootstrapStatus();
      setAppVersion(bootstrap.appVersion || null);
      if (bootstrap.v2Migration?.required) {
        setMigration(bootstrap.v2Migration);
      } else {
        setMigration(null);
      }
    } catch {
      setMigration(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleComplete = () => {
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="app-loading app-loading--screen">
        <div className="app-loading__spinner app-loading__spinner--lg" />
      </div>
    );
  }

  if (migration?.required) {
    return (
      <V2MigrationModal
        preview={migration.preview}
        appVersion={appVersion}
        onComplete={handleComplete}
      />
    );
  }

  return children;
}

V2MigrationGate.propTypes = {
  children: PropTypes.node.isRequired,
};
