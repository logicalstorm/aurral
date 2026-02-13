import { useRegisterSW } from "virtual:pwa-register/react";

function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered() {},
    onRegisterError() {},
  });

  const close = () => {
    setNeedRefresh(false);
  };

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      className="fixed bottom-0 right-0 p-4 m-4 z-50 shadow-xl max-w-sm w-full animate-slide-up"
      style={{ backgroundColor: "#211f27" }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex-1">
          <p className="text-sm font-medium" style={{ color: "#fff" }}>
            New content available, click on reload button to update.
          </p>
        </div>
        <div className="flex gap-2 mt-2">
          <button
            className="flex-1 px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2"
            style={{
              backgroundColor: "#707e61",
              color: "#fff",
              "--tw-ring-color": "#c1c1c3",
            }}
            onClick={() => updateServiceWorker(true)}
          >
            Reload
          </button>
          <button
            className="flex-1 px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2"
            style={{
              "--tw-ring-color": "#c1c1c3",
              backgroundColor: "#211f27",
              color: "#fff",
            }}
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
