import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Plus, Check } from 'lucide-react';
import './AddToLibraryButton.css';

const AddToLibraryButton = ({ onClick, className }) => {
  const [isSuccess, setIsSuccess] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const handleClick = async (e) => {
    e.preventDefault();
    if (onClick) {
      const success = await onClick();
      if (isMounted.current && success !== false) {
        setIsSuccess(true);
      }
    }
  };

  return (
    <button
      className={`add-to-library-button ${isSuccess ? 'success' : ''} ${className || ''}`}
      onClick={handleClick}
      type="button"
    >
      <span>Add to Library</span>
      <div className="icon">
        <Plus className="plus-icon" />
        <Check className="check-icon" />
      </div>
    </button>
  );
};

AddToLibraryButton.propTypes = {
  onClick: PropTypes.func,
  className: PropTypes.string,
};

export default AddToLibraryButton;
