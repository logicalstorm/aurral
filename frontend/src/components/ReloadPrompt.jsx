import React from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log("SW Registered: " + r);
    },
    onRegisterError(error) {
      console.log("SW registration error", error);
    },
  });

  const close = () => {
    setNeedRefresh(false);
  };

  if (!needRefresh) {
    return null;
  }

  return (
    <div className="fixed bottom-0 right-0 p-4 m-4 z-50 bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 max-w-sm w-full animate-slide-up">
      <div className="flex flex-col gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            New content available, click on reload button to update.
          </p>
        </div>
        <div className="flex gap-2 mt-2">
          <button
            className="flex-1 px-3 py-1.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:focus:ring-offset-gray-800"
            onClick={() => updateServiceWorker(true)}
          >
            Reload
          </button>
          <button
            className="flex-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600 dark:focus:ring-offset-gray-800"
            onClick={close}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReloadPrompt;
