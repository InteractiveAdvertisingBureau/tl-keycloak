import { Link } from "react-router-dom";

export default function UnauthorizedPage() {
  return (
    <div className="portal-panel">
      <h1>Unauthorized</h1>
      <p className="muted">You do not have access to this area.</p>
      <Link to="/portal">Back to portal</Link>
    </div>
  );
}
