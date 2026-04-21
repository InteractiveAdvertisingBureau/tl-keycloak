import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

export default function PortalPage() {
  const [me, setMe] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    window.AuthSDK.fetchMe()
      .then(setMe)
      .catch((e) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <div className="portal-panel">
        <h1>Portal</h1>
        <p style={{ color: "#b91c1c" }}>{err}</p>
        <p className="muted">
          Ensure the gateway can reach authz and your user has an internal id (JWT → authz resolve/ensure).
        </p>
      </div>
    );
  }
  if (!me) return <p className="muted">Loading portal…</p>;

  if (!me?.dashboard?.features?.portal?.view) {
    return <Navigate to="/unauthorized" replace />;
  }

  return (
    <div className="portal-panel">
      <h1>Portal</h1>
      <p className="muted">
        Loaded from <code>GET /me</code> on the API gateway (roles + permissions + dashboard config).
      </p>
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Roles</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {(me.roles || []).length ? (
            me.roles.map((r) => <li key={r}>{r}</li>)
          ) : (
            <li style={{ color: "#64748b" }}>No roles assigned</li>
          )}
        </ul>
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>Permissions</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {(me.permissions || []).length ? (
            me.permissions.map((p) => <li key={p}>{p}</li>)
          ) : (
            <li style={{ color: "#64748b" }}>None</li>
          )}
        </ul>
      </section>
      <pre
        style={{
          background: "#fff",
          padding: 16,
          borderRadius: 8,
          border: "1px solid #e2e8f0",
          overflow: "auto",
          fontSize: 13,
        }}
      >
        {JSON.stringify(me, null, 2)}
      </pre>
    </div>
  );
}
