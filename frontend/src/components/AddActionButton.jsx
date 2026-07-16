import { forwardRef } from "react";
import { Loader, Plus } from "lucide-react";

const AddActionButton = forwardRef(function AddActionButton(
  {
    label = "Add to Lidarr",
    icon: Icon = Plus,
    isLoading = false,
    isExpanded = false,
    disabled = false,
    className = "",
    type = "button",
    ...buttonProps
  },
  ref,
) {
  const classes = ["btn", "btn-add-action", isExpanded ? "is-expanded" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || isLoading}
      title={buttonProps.title ?? label}
    >
      <span className="btn-add-action__icon">
        {isLoading ? (
          <Loader className="animate-spin" aria-hidden="true" />
        ) : (
          <Icon aria-hidden="true" />
        )}
      </span>
      <span className="btn-add-action__label">{label}</span>
    </button>
  );
});

export default AddActionButton;
