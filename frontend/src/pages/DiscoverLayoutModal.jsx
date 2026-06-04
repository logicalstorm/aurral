import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import { GripVertical, X } from "lucide-react";

const FALLBACK_GENRE_SECTION_PREFIX = "fallbackGenre:";

const getFallbackGenreFromSectionId = (id) =>
  String(id || "").startsWith(FALLBACK_GENRE_SECTION_PREFIX)
    ? String(id).slice(FALLBACK_GENRE_SECTION_PREFIX.length)
    : null;

function SortableSectionRow({ item, onToggle, showUnavailable }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 px-4 py-3 border bg-[#1a191f] ${
        item.enabled ? "text-white" : "text-[#8a8a8f] opacity-70"
      } ${
        isDragging
          ? "z-10 border-[#707e61] bg-[#1b1c21] shadow-lg opacity-95"
          : "border-transparent"
      }`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="flex h-9 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded text-[#c1c1c3] hover:bg-white/5 active:cursor-grabbing"
        style={{ color: item.enabled ? "#c1c1c3" : "#6f6f78" }}
        aria-label={`Reorder ${item.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <span
          className="text-sm font-semibold"
          style={{ color: item.enabled ? "#fff" : "#8a8a8f" }}
        >
          {item.label}
        </span>
        {showUnavailable && (
          <span className="text-xs" style={{ color: "#8a8a8f" }}>
            Not enough data yet
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => onToggle(item.id)}
        className="shrink-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-opacity hover:opacity-90"
        style={{
          backgroundColor: item.enabled ? "#707e61" : "#2d2c32",
          color: item.enabled ? "#0b0b0c" : "#c1c1c3",
        }}
        aria-pressed={item.enabled}
        aria-label={`${item.enabled ? "Hide" : "Show"} ${item.label}`}
      >
        {item.enabled ? "Active" : "Hidden"}
      </button>
    </div>
  );
}

SortableSectionRow.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    enabled: PropTypes.bool.isRequired,
  }).isRequired,
  onToggle: PropTypes.func.isRequired,
  showUnavailable: PropTypes.bool.isRequired,
};

export function DiscoverLayoutModal({
  open,
  sections,
  onSectionsChange,
  sectionAvailability,
  isSaving,
  onClose,
  onSave,
  onReset,
}) {
  const sectionIds = useMemo(() => sections.map((item) => item.id), [sections]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !isSaving) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, isSaving, onClose]);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onSectionsChange((prev) => {
      const oldIndex = prev.findIndex((item) => item.id === active.id);
      const newIndex = prev.findIndex((item) => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  if (!open) return null;

  return createPortal(
    <div
      className="artist-modal-backdrop"
      onClick={isSaving ? undefined : onClose}
      role="presentation"
    >
      <div
        className="flex w-full max-w-2xl flex-col overflow-hidden border border-white/10 shadow-2xl"
        style={{
          backgroundColor: "#14141a",
          height: "min(600px, 90vh)",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discover-layout-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b border-white/10 px-5 py-4"
          style={{
            background:
              "linear-gradient(135deg, rgba(40,38,49,0.9), rgba(20,20,26,0.8))",
          }}
        >
          <div>
            <h3
              id="discover-layout-modal-title"
              className="text-xl font-bold"
              style={{ color: "#fff" }}
            >
              Customize Discover
            </h3>
            <p className="mt-1 text-sm" style={{ color: "#c1c1c3" }}>
              Drag to reorder. Use Active/Hidden to choose what appears.
            </p>
          </div>
          <button
            type="button"
            className="rounded p-2 transition-colors hover:bg-[#2a2a2e]"
            style={{ color: "#c1c1c3" }}
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4">
            <SortableContext
              items={sectionIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {sections.map((item) => (
                  <SortableSectionRow
                    key={item.id}
                    item={item}
                    onToggle={(id) =>
                      onSectionsChange((prev) =>
                        prev.map((section) =>
                          section.id === id
                            ? { ...section, enabled: !section.enabled }
                            : section,
                        ),
                      )
                    }
                    showUnavailable={
                      !getFallbackGenreFromSectionId(item.id) &&
                      !sectionAvailability[item.id]
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </div>
        </DndContext>

        <div
          className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4"
          style={{ backgroundColor: "#111117" }}
        >
          <button
            type="button"
            onClick={onReset}
            className="btn btn-secondary"
            disabled={isSaving}
          >
            Reset to Default
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSave}
              className="btn btn-primary"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Layout"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

DiscoverLayoutModal.propTypes = {
  open: PropTypes.bool.isRequired,
  sections: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      enabled: PropTypes.bool.isRequired,
    }),
  ).isRequired,
  onSectionsChange: PropTypes.func.isRequired,
  sectionAvailability: PropTypes.object.isRequired,
  isSaving: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onReset: PropTypes.func.isRequired,
};
