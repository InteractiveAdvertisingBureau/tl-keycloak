import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

const ROLE_ORDER = { ADMIN: 0, USER: 1 };

function sortRoleNames(names) {
  return [...names].sort(
    (a, b) => (ROLE_ORDER[a] ?? 99) - (ROLE_ORDER[b] ?? 99)
  );
}

export default function UsersPage() {
  const [allowed, setAllowed] = useState(null);
  const [dash, setDash] = useState(null);
  const [users, setUsers] = useState([]);
  const [roleCatalog, setRoleCatalog] = useState([]);
  const [draftByUser, setDraftByUser] = useState({});
  const [myUserId, setMyUserId] = useState(null);
  const [listError, setListError] = useState(null);
  const [rowBusy, setRowBusy] = useState({});
  const [rowMessage, setRowMessage] = useState({});

  const canManageRoles = Boolean(dash?.features?.users?.manageRoles);
  const roleNamesSorted = useMemo(
    () =>
      sortRoleNames(
        roleCatalog.length
          ? roleCatalog.map((r) => r.name)
          : ["ADMIN", "USER"]
      ),
    [roleCatalog]
  );

  const syncDraftFromUsers = useCallback((list) => {
    const next = {};
    for (const u of list) {
      next[u.id] = sortRoleNames(u.roles || []);
    }
    setDraftByUser(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await window.AuthSDK.fetchDashboard();
        if (cancelled) return;
        setDash(d);
        setAllowed(Boolean(d?.features?.users?.view));
        if (!d?.features?.users?.view) return;

        const me = await window.AuthSDK.fetchMe().catch(() => null);
        if (!cancelled && me?.user?.userId) {
          setMyUserId(me.user.userId);
        }

        const { users: ulist } = await window.AuthSDK.fetchAdminUsers();
        if (cancelled) return;
        setUsers(ulist || []);
        syncDraftFromUsers(ulist || []);

        if (d?.features?.users?.manageRoles) {
          const cat = await window.AuthSDK.fetchAdminRolesCatalog().catch(
            () => ({ roles: [] })
          );
          if (!cancelled) {
            setRoleCatalog(cat.roles || []);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setListError(e?.message || "Failed to load users");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncDraftFromUsers]);

  const toggleRole = (userId, roleName, checked) => {
    setDraftByUser((prev) => {
      const cur = new Set(prev[userId] || []);
      if (checked) cur.add(roleName);
      else cur.delete(roleName);
      return { ...prev, [userId]: sortRoleNames([...cur]) };
    });
  };

  const saveRow = async (userId) => {
    const roles = draftByUser[userId];
    if (!roles?.length) {
      setRowMessage((m) => ({
        ...m,
        [userId]: "Select at least one role.",
      }));
      return;
    }
    setRowBusy((b) => ({ ...b, [userId]: true }));
    setRowMessage((m) => ({ ...m, [userId]: "" }));
    try {
      await window.AuthSDK.updateUserRoles(userId, roles);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, roles } : u))
      );
      setRowMessage((m) => ({ ...m, [userId]: "Saved." }));
    } catch (e) {
      setRowMessage((m) => ({
        ...m,
        [userId]: e?.message || "Save failed",
      }));
    } finally {
      setRowBusy((b) => ({ ...b, [userId]: false }));
    }
  };

  const resetRow = (userId, originalRoles) => {
    setDraftByUser((prev) => ({
      ...prev,
      [userId]: sortRoleNames(originalRoles || []),
    }));
    setRowMessage((m) => ({ ...m, [userId]: "" }));
  };

  if (allowed === false) {
    return <Navigate to="/unauthorized" replace />;
  }
  if (allowed === null && !listError) return <p>Loading…</p>;
  if (listError) {
    return (
      <div className="portal-panel">
        <h1>Users</h1>
        <p className="muted">{listError}</p>
      </div>
    );
  }

  return (
    <div className="portal-panel">
      <h1>Users</h1>
      <p className="muted">
        Directory from authorization service.{" "}
        {canManageRoles
          ? "You can change each user’s roles and save per row."
          : "Role changes require the administrator permission to manage roles."}
      </p>

      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>User ID</th>
              <th>Roles</th>
              {canManageRoles ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const draft = draftByUser[u.id] || [];
              const original = sortRoleNames(u.roles || []);
              const dirty =
                JSON.stringify(draft) !== JSON.stringify(original);
              return (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {myUserId === u.id ? (
                      <span className="users-you"> (you)</span>
                    ) : null}
                  </td>
                  <td className="users-mono">{u.id}</td>
                  <td>
                    {canManageRoles ? (
                      <div className="users-role-chips">
                        {roleNamesSorted.map((name) => (
                          <label key={name} className="users-role-label">
                            <input
                              type="checkbox"
                              checked={draft.includes(name)}
                              onChange={(ev) =>
                                toggleRole(u.id, name, ev.target.checked)
                              }
                            />
                            {name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <span>{original.join(", ") || "—"}</span>
                    )}
                    {canManageRoles && rowMessage[u.id] ? (
                      <div
                        className={
                          rowMessage[u.id] === "Saved."
                            ? "users-row-msg ok"
                            : "users-row-msg err"
                        }
                      >
                        {rowMessage[u.id]}
                      </div>
                    ) : null}
                  </td>
                  {canManageRoles ? (
                    <td className="users-actions">
                      <button
                        type="button"
                        className="users-btn primary"
                        disabled={!dirty || rowBusy[u.id]}
                        onClick={() => saveRow(u.id)}
                      >
                        {rowBusy[u.id] ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="users-btn"
                        disabled={!dirty || rowBusy[u.id]}
                        onClick={() => resetRow(u.id, u.roles)}
                      >
                        Reset
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {users.length === 0 ? (
          <p className="muted users-empty">No users found.</p>
        ) : null}
      </div>
    </div>
  );
}
