import { useState, useEffect } from "react";
import {
  Play,
  Heart,
  Trash2,
  Clock,
  Music,
  CheckCircle,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import {
  getWeeklyFlow,
  toggleWeeklyFlow,
  generateWeeklyFlow,
  keepFlowItem,
  removeFlowItem,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import ArtistImage from "../components/ArtistImage";

function FlowPage() {
  const [flow, setFlow] = useState({
    enabled: false,
    items: [],
    updatedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [generating, setGenerating] = useState(false);
  const { showSuccess, showError } = useToast();

  const fetchFlow = async () => {
    try {
      const data = await getWeeklyFlow();
      setFlow(data);
    } catch (err) {
      console.error("Failed to fetch flow:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlow();
  }, []);

  const handleToggle = async () => {
    setToggling(true);
    const newState = !flow.enabled;
    try {
      await toggleWeeklyFlow(newState);
      setFlow((prev) => ({ ...prev, enabled: newState }));
      showSuccess(
        newState
          ? "Weekly Discovery enabled. It will run automatically."
          : "Weekly Discovery disabled.",
      );
    } catch (err) {
      showError("Failed to update settings");
    } finally {
      setToggling(false);
    }
  };

  const handleKeep = async (mbid) => {
    try {
      await keepFlowItem(mbid);
      setFlow((prev) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.mbid === mbid ? { ...i, isEphemeral: false } : i,
        ),
      }));
      showSuccess("Artist kept permanently!");
    } catch (err) {
      showError("Failed to keep item");
    }
  };

  const handleRemove = async (mbid) => {
    if (!window.confirm("Remove this artist and delete files?")) return;
    try {
      await removeFlowItem(mbid);
      setFlow((prev) => ({
        ...prev,
        items: prev.items.filter((i) => i.mbid !== mbid),
      }));
      showSuccess("Item removed.");
    } catch (err) {
      showError("Failed to remove item");
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await generateWeeklyFlow();
      await fetchFlow();
      showSuccess(`Generated ${result.count || 0} new recommendations!`);
    } catch (err) {
      showError(err.response?.data?.details || "Failed to generate playlist");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
            <Play className="w-8 h-8 text-primary-500 mr-3 fill-current" />
            Weekly Discovery
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Automated weekly rotation. "Ephemeral" items are deleted next week
            unless kept.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {flow.enabled ? "Active" : "Disabled"}
          </span>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`text-4xl transition-colors ${flow.enabled ? "text-primary-600" : "text-gray-400"}`}
          >
            {flow.enabled ? (
              <ToggleRight className="w-10 h-10 fill-current" />
            ) : (
              <ToggleLeft className="w-10 h-10" />
            )}
          </button>
        </div>
      </div>

      {flow.updatedAt && (
        <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
          <Clock className="w-4 h-4 mr-1" />
          Last updated: {new Date(flow.updatedAt).toLocaleString()}
        </div>
      )}

      {!flow.enabled && flow.items.length === 0 ? (
        <div className="card text-center py-12">
          <Music className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 dark:text-gray-100 mb-2">
            Weekly Discovery is Disabled
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Enable it to start receiving a fresh playlist every Monday.
          </p>
          <button onClick={handleToggle} className="btn btn-primary">
            Enable Automation
          </button>
        </div>
      ) : flow.items.length === 0 ? (
        <div className="card text-center py-12">
          <Music className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 dark:text-gray-100 mb-2">
            No playlist yet
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Generate your first weekly discovery playlist now, or wait for
            automatic generation on Monday.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn btn-primary"
          >
            {generating ? (
              <>
                <div className="animate-spin h-4 w-4 border-b-2 border-white mr-2 inline-block"></div>
                Generating...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2 inline" />
                Generate Now
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {flow.items.map((item) => (
            <div
              key={item.mbid}
              className={`card group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
                !item.isEphemeral ? "border-green-500/20 bg-green-50/10" : ""
              }`}
            >
              <div className="aspect-square relative overflow-hidden mb-4 bg-gray-100 dark:bg-gray-800">
                <ArtistImage
                  mbid={item.mbid}
                  name={item.artistName}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={() => handleKeep(item.mbid)}
                    className={`p-3 backdrop-blur-sm transition-transform hover:scale-110 ${
                      !item.isEphemeral
                        ? "bg-green-500 text-white"
                        : "bg-white/20 text-white hover:bg-green-500"
                    }`}
                    title={item.isEphemeral ? "Keep permanently" : "Kept"}
                  >
                    <Heart
                      className={`w-6 h-6 ${!item.isEphemeral ? "fill-current" : ""}`}
                    />
                  </button>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-gray-900 dark:text-gray-100 truncate">
                  {item.trackName}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                  {item.artistName}
                </p>
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    {item.isEphemeral ? (
                      <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 flex items-center">
                        <Clock className="w-3 h-3 mr-1" /> Ephemeral
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 flex items-center">
                        <CheckCircle className="w-3 h-3 mr-1" /> Kept
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemove(item.mbid)}
                    className="text-gray-400 hover:text-red-500 transition-colors p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default FlowPage;
