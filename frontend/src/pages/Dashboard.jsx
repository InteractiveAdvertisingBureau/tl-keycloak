import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    window.AuthSDK.fetchDashboard()
      .then(setData)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <div className="portal-panel">
        <h1>Dashboard</h1>
        <p style={{ color: "#b91c1c" }}>{err}</p>
        <p className="muted">
          Ensure your JWT <code>sub</code> exists in authz <code>users</code> (see
          AUTHZ_ADMIN_SUB / seeds).
        </p>
      </div>
    );
  }
  if (!data) return <p className="muted">Loading…</p>;

  if (!data?.features?.dashboard?.view) {
    return <Navigate to="/unauthorized" replace />;
  }

  return (
    <div className="portal-panel">
      <h1>Dashboard</h1>
      <pre
        style={{
          background: "#fff",
          padding: 16,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          overflow: "auto",
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
