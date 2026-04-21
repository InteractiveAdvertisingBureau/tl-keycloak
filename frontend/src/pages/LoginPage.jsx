import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";

export default function LoginPage() {
  const navigate = useNavigate();
  const hostRef = useRef(null);
  const mountApi = useRef(null);

  useEffect(() => {
    const goPortal = () => {
      if (window.AuthSDK?.getAccessToken?.()) {
        navigate("/portal", { replace: true });
      }
    };
    goPortal();
    window.addEventListener("tl-auth-token", goPortal);
    window.addEventListener("storage", goPortal);
    return () => {
      window.removeEventListener("tl-auth-token", goPortal);
      window.removeEventListener("storage", goPortal);
    };
  }, [navigate]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !window.AuthSDK?.mountLogin) return;
    mountApi.current?.unmount();
    mountApi.current = window.AuthSDK.mountLogin(el, {
      onSuccess: () => navigate("/portal", { replace: true }),
    });
    return () => {
      mountApi.current?.unmount();
      mountApi.current = null;
    };
  }, [navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark">IAB</span>
          <span className="auth-brand-name">Tech Lab</span>
        </div>
        <h1 className="auth-heading">Sign in</h1>
        <p className="auth-sub">Use your email and password, or Auth0 if enabled.</p>
        <div ref={hostRef} className="auth-sdk-host" />
        <p className="auth-switch">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
