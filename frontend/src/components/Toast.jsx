import { useEffect } from "react";
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
    success: <CheckCircle className="w-5 h-5 text-green-500" />,
    error: <AlertCircle className="w-5 h-5 text-red-500" />,
    info: <Info className="w-5 h-5 text-blue-500" />,
  };

  const styles = {
    success:
      "border-green-200 bg-green-50 dark:bg-green-900/80 dark:border-green-900/50",
    error: "border-red-200 bg-red-50 dark:bg-red-900/80 dark:border-red-900/50",
    info: "border-blue-200 bg-blue-50 dark:bg-blue-900/80 dark:border-blue-900/50",
  };

  return (
    <div
      className={`flex items-center w-full max-w-sm p-4 mb-4 text-gray-900 bg-white shadow-lg dark:bg-gray-800 dark:text-gray-300 border ${
        styles[type] || styles.info
      } animate-slide-in-right transition-all duration-300`}
      role="alert"
    >
      <div className="flex-shrink-0">{icons[type] || icons.info}</div>
      <div className="ml-3 text-sm font-normal">{message}</div>
      <button
        type="button"
        className="ml-auto -mx-1.5 -my-1.5 bg-transparent text-gray-400 hover:text-gray-900 focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-gray-100 inline-flex h-8 w-8 dark:text-gray-500 dark:hover:text-white dark:hover:bg-gray-700"
        onClick={() => onDismiss(id)}
        aria-label="Close"
      >
        <span className="sr-only">Close</span>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

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
