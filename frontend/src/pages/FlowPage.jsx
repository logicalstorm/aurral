import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Trash2, Music, Clock } from "lucide-react";
import {
  getWeeklyFlow,
  toggleWeeklyFlow,
  generateWeeklyFlow,
  removeFlowItem,
} from "../utils/api";
import { useToast } from "../contexts/ToastContext";
import ArtistImage from "../components/ArtistImage";
import PowerSwitch from "../components/PowerSwitch";

function FlowPage() {
  const navigate = useNavigate();
  const [flow, setFlow] = useState({
    enabled: false,
    items: [],
    updatedAt: null,
  });
  const [loading, setLoading] = useState(true);
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

  const handleToggle = async (e) => {
    const newState = e.target.checked;
    
    // Optimistic update - update UI immediately for instant feedback
    setFlow((prev) => ({ ...prev, enabled: newState }));
    
    // Make API call in background without blocking UI
    toggleWeeklyFlow(newState)
      .then(() => {
        showSuccess(
          newState
            ? "Weekly Discovery enabled. It will run automatically."
            : "Weekly Discovery disabled.",
        );
      })
      .catch(() => {
        // Revert on error
        setFlow((prev) => ({ ...prev, enabled: !newState }));
        showError("Failed to update settings");
      });
  };


  const handleRemove = async (e, mbid) => {
    e.stopPropagation(); // Prevent navigation when clicking remove button
    if (!window.confirm("Remove this artist and delete files?")) return;
    try {
      await removeFlowItem(mbid);
      setFlow((prev) => ({
        ...prev,
        items: prev.items.filter((i) => i.mbid !== mbid),
      }));
      showSuccess("Item removed.");
    } catch {
      showError("Failed to remove item");
    }
  };

  const handleCardClick = (mbid) => {
    navigate(`/artist/${mbid}`);
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
        <div className="animate-spin h-12 w-12 "></div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1
            className="text-3xl font-bold flex items-center"
            style={{ color: "#fff" }}
          >
            Weekly Discovery
          </h1>
          <p className="mt-1" style={{ color: "#c1c1c3" }}>
            Revolving door playlist: 40 tracks initially, 10 rotate out weekly. All tracks are temporary.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <PowerSwitch
            checked={flow.enabled}
            onChange={handleToggle}
          />
        </div>
      </div>

      {flow.updatedAt && (
        <div className="flex items-center text-sm" style={{ color: "#c1c1c3" }}>
          <Clock className="w-4 h-4 mr-1" />
          Last updated: {new Date(flow.updatedAt).toLocaleString()}
        </div>
      )}

      {!flow.enabled && flow.items.length === 0 ? (
        <div className="card text-center py-12">
          <Music
            className="w-16 h-16 mx-auto mb-4"
            style={{ color: "#c1c1c3" }}
          />
          <h3 className="text-xl font-medium mb-2" style={{ color: "#fff" }}>
            Weekly Discovery is Disabled
          </h3>
          <p className="mb-6" style={{ color: "#c1c1c3" }}>
            Enable it to start receiving a fresh playlist every Monday.
          </p>
          <button onClick={handleToggle} className="btn btn-primary">
            Enable Automation
          </button>
        </div>
      ) : flow.items.length === 0 ? (
        <div className="card text-center py-12">
          <Music
            className="w-16 h-16 mx-auto mb-4"
            style={{ color: "#c1c1c3" }}
          />
          <h3 className="text-xl font-medium mb-2" style={{ color: "#fff" }}>
            No playlist yet
          </h3>
          <p className="mb-6" style={{ color: "#c1c1c3" }}>
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
                <div className="animate-spin h-4 w-4 "></div>
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
              className="card group relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 cursor-pointer"
              onClick={() => handleCardClick(item.mbid)}
            >
              <div
                className="aspect-square relative overflow-hidden mb-4"
                style={{ backgroundColor: "#211f27" }}
              >
                <ArtistImage
                  mbid={item.mbid}
                  name={item.artistName}
                  className="w-full h-full object-cover"
                />
              </div>

              <div>
                <h3 className="font-bold truncate" style={{ color: "#fff" }}>
                  {item.trackName}
                </h3>
                <p className="text-sm truncate" style={{ color: "#c1c1c3" }}>
                  {item.artistName}
                </p>
                <div className="flex items-center justify-end mt-3">
                  <button
                    onClick={(e) => handleRemove(e, item.mbid)}
                    className="hover:text-red-400 transition-colors p-1"
                    style={{ color: "#c1c1c3" }}
                    title="Remove from weekly flow"
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
