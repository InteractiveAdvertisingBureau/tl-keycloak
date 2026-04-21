import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export default function PortalLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [kcPwBanner, setKcPwBanner] = useState(null);

  const bannerEligiblePath =
    location.pathname === "/dashboard" || location.pathname === "/portal";

  const loadKcPasswordBanner = useCallback(async () => {
    if (!bannerEligiblePath) {
      setKcPwBanner(null);
      return;
    }
    const tok = window.AuthSDK?.getAccessToken?.();
    if (!tok || !window.AuthSDK?.isAuth0AccessToken?.(tok)) {
      setKcPwBanner(null);
      return;
    }
    try {
      const s = await window.AuthSDK.getKcPasswordStatus();
      if (!s.needsPassword) {
        setKcPwBanner(null);
        return;
      }
      if (s.keycloakUserMissing) {
        setKcPwBanner({ type: "sync" });
        return;
      }
      const daysRemaining =
        typeof s.daysRemaining === "number" ? s.daysRemaining : 0;
      setKcPwBanner({
        type: "deadline",
        deadlineIso: s.deadlineIso,
        daysRemaining,
        deadlinePassed: Boolean(s.deadlinePassed),
      });
    } catch {
      setKcPwBanner(null);
    }
  }, [bannerEligiblePath]);

  useEffect(() => {
    loadKcPasswordBanner();
  }, [loadKcPasswordBanner]);

  useEffect(() => {
    function onToken() {
      loadKcPasswordBanner();
    }
    window.addEventListener("tl-auth-token", onToken);
    return () => window.removeEventListener("tl-auth-token", onToken);
  }, [loadKcPasswordBanner]);

  useEffect(() => {
    window.AuthSDK.fetchMe().then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function close(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  function logout() {
    window.AuthSDK.logout();
    setMenuOpen(false);
    navigate("/login");
  }

  const token = window.AuthSDK?.getAccessToken?.();
  const claims = token ? decodeJwtPayload(token) : null;
  const display =
    me?.email ||
    me?.username ||
    claims?.email ||
    claims?.name ||
    claims?.preferred_username ||
    "Account";

  const initial = String(display).trim().charAt(0).toUpperCase() || "?";

  const navItems = (me?.dashboard?.menu || []).filter((item) => item.visible);
  const brandPath = navItems[0]?.path ?? "/portal";

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <Link to={brandPath} className="portal-sidebar-brand">
          <span className="portal-sidebar-brand-mark">IAB</span>
          <span className="portal-sidebar-brand-text">Tech Lab</span>
        </Link>
        <nav className="portal-sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              end={item.path === "/portal"}
              to={item.path}
              className="portal-nav-link"
            >
              {item.name}
            </NavLink>
          ))}
        </nav>
        <div className="portal-sidebar-foot">
          Internal authorization demo — IAB Tech Lab styling.
        </div>
      </aside>
      <div className="portal-main">
        <header className="portal-topbar">
          <span className="portal-topbar-title">Tech Lab Portal</span>
          <div className="portal-topbar-spacer" />
          <div className="portal-user-wrap" ref={menuRef}>
            <button
              type="button"
              className="portal-user-btn"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              onClick={() => setMenuOpen((o) => !o)}
              title="Account menu"
            >
              <span className="portal-user-avatar">{initial}</span>
            </button>
            {menuOpen ? (
              <div className="portal-user-menu" role="menu">
                <div className="portal-user-menu-email">{display}</div>
                <button type="button" className="portal-user-menu-item" onClick={logout}>
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <div className="portal-content">
          <Outlet />
        </div>
        {kcPwBanner ? (
          <div
            className="portal-kc-password-banner"
            role="region"
            aria-label="Keycloak password reminder"
          >
            {kcPwBanner.type === "sync" ? (
              <>
                <p className="portal-kc-password-banner-text">
                  Finishing account setup for Keycloak sign-in. If this persists,
                  try again in a moment or sign out and sign in again.
                </p>
                <button
                  type="button"
                  className="portal-kc-password-banner-btn portal-kc-password-banner-btn-secondary"
                  onClick={() => loadKcPasswordBanner()}
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <p className="portal-kc-password-banner-text">
                  {kcPwBanner.deadlinePassed
                    ? "Your suggested window to add a Keycloak password has passed. You can still set one to sign in with email and password here."
                    : `Set a Keycloak password for email sign-in. You have ${kcPwBanner.daysRemaining} day${kcPwBanner.daysRemaining === 1 ? "" : "s"} left${kcPwBanner.deadlineIso ? ` (by ${new Date(kcPwBanner.deadlineIso).toLocaleDateString(undefined, { dateStyle: "medium" })})` : ""}.`}
                </p>
                <button
                  type="button"
                  className="portal-kc-password-banner-btn"
                  onClick={async () => {
                    await window.AuthSDK.promptKcPasswordEnrollment?.();
                    await loadKcPasswordBanner();
                  }}
                >
                  Set password
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
