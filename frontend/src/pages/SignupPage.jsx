import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef } from "react";

export default function SignupPage() {
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
    if (!el || !window.AuthSDK?.mountSignup) return;
    mountApi.current?.unmount();
    mountApi.current = window.AuthSDK.mountSignup(el, {
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
        <h1 className="auth-heading">Create account</h1>
        <p className="auth-sub">Register to access the Tech Lab portal.</p>
        <div ref={hostRef} className="auth-sdk-host" />
        <p className="auth-switch">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
