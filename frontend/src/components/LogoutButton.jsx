import PropTypes from 'prop-types';
import { LogOut } from 'lucide-react';
import './LogoutButton.css';

const LogoutButton = ({ onClick }) => {
  return (
    <div className="logout-trapdoor" onClick={onClick} role="button" tabIndex={0}>
      {/* Content hidden behind doors */}
      <div className="logout-content">
        <span>Log Out</span>
      </div>

      {/* Top Door */}
      <div className="logout-door top">
        <div className="logout-door-inner">
          <LogOut className="w-4 h-4" />
        </div>
      </div>

      {/* Bottom Door */}
      <div className="logout-door bottom">
        <div className="logout-door-inner">
          <LogOut className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
};

LogoutButton.propTypes = {
  onClick: PropTypes.func.isRequired,
};

export default LogoutButton;
