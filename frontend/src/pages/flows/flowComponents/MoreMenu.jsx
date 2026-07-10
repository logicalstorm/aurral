import { useState, useEffect, useRef } from "react";
import { MoreHorizontal } from "lucide-react";

export function MoreMenu({ children, activeButtonClass = "btn-primary" }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className={`flow-page__menu-wrap${isOpen ? " is-open" : ""}`} ref={menuRef}>
      <button 
        type="button" 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} 
        className={`btn btn-sm btn--toolbar ${isOpen ? activeButtonClass : "btn-secondary"}`}
        aria-label="More options"
      >
        <MoreHorizontal className="artist-icon-sm" />
        <span className="flow-page__btn-label--wide">More</span>
      </button>
      {isOpen && (
        <>
          <button
            type="button"
            className="artist-backdrop-button"
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
          />
          <div
            className="artist-dropdown artist-dropdown--right"
            onClick={() => setIsOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
