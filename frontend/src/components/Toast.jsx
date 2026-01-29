import { useEffect } from "react";
import PropTypes from "prop-types";
import { CheckCircle, AlertCircle, X, Info } from "lucide-react";

export function Toast({ toast, onDismiss }) {
  const { id, type, message, duration = 3000 } = toast;

  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(id);
    }, duration);

    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]);

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-green-400" />,
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    info: <Info className="w-5 h-5" style={{ color: "#c1c1c3" }} />,
  };

  const styles = {
    success: "bg-green-500/20",
    error: "bg-red-500/20",
    info: "",
  };

  return (
    <div
      className={`flex items-center w-full max-w-sm p-4 mb-4 backdrop-blur-sm shadow-lg ${
        styles[type] || styles.info
      } animate-slide-in-right transition-all duration-300`}
      style={{ backgroundColor: "#211f27", color: "#fff" }}
      role="alert"
    >
      <div className="flex-shrink-0">{icons[type] || icons.info}</div>
      <div className="ml-3 text-sm font-normal">{message}</div>
      <button
        type="button"
        className="ml-auto -mx-1.5 -my-1.5 bg-transparent focus:ring-2 focus:ring-gray-600 p-1.5 inline-flex h-8 w-8"
        style={{ color: "#c1c1c3" }}
        onClick={() => onDismiss(id)}
        aria-label="Close"
      >
        <span className="sr-only">Close</span>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

Toast.propTypes = {
  toast: PropTypes.shape({
    id: PropTypes.string.isRequired,
    type: PropTypes.oneOf(["success", "error", "info"]).isRequired,
    message: PropTypes.string.isRequired,
    duration: PropTypes.number,
  }).isRequired,
  onDismiss: PropTypes.func.isRequired,
};

export function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end space-y-2 pointer-events-none">
      <div className="flex flex-col items-end pointer-events-auto">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

ToastContainer.propTypes = {
  toasts: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      type: PropTypes.oneOf(["success", "error", "info"]).isRequired,
      message: PropTypes.string.isRequired,
      duration: PropTypes.number,
    }),
  ).isRequired,
  onDismiss: PropTypes.func.isRequired,
};
