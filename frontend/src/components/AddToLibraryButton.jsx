import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { Plus, Check, Loader } from "lucide-react";
import "./AddToLibraryButton.css";

const AddToLibraryButton = ({ onClick, className, isLoading }) => {
  const [isSuccess, setIsSuccess] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleClick = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    if (onClick) {
      const success = await onClick();
      if (isMounted.current && success !== false) {
        setIsSuccess(true);
      }
    }
  };

  return (
    <button
      className={`add-to-library-button ${isSuccess ? "success" : ""} ${className || ""}`}
      onClick={handleClick}
      disabled={isLoading}
      type="button"
    >
      <span>Add to Library</span>
      <div className="icon">
        {isLoading ? (
          <Loader className="animate-spin" />
        ) : (
          <>
            <Plus className="plus-icon" />
            <Check className="check-icon" />
          </>
        )}
      </div>
    </button>
  );
};

AddToLibraryButton.propTypes = {
  onClick: PropTypes.func,
  className: PropTypes.string,
  isLoading: PropTypes.bool,
};

export default AddToLibraryButton;
