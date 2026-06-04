import PropTypes from 'prop-types';
import { Plus, Loader } from 'lucide-react';
import './AddAlbumButton.css';

const AddAlbumButton = ({
  onClick,
  isLoading,
  disabled,
  className,
  style,
  label = "Add to Lidarr",
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`add-album-btn ${className || ""}`}
      style={style}
      title={label}
    >
      <div className="icon-container">
        {isLoading ? (
          <Loader className="w-4 h-4 animate-spin" />
        ) : (
          <Plus className="w-4 h-4" />
        )}
      </div>
      <span className="label">{label}</span>
    </button>
  );
};

AddAlbumButton.propTypes = {
  onClick: PropTypes.func.isRequired,
  isLoading: PropTypes.bool,
  disabled: PropTypes.bool,
  className: PropTypes.string,
  style: PropTypes.object,
  label: PropTypes.string,
};

export default AddAlbumButton;
