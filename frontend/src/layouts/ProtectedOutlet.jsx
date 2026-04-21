import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";

export default function ProtectedOutlet() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const sync = () => setTick((n) => n + 1);
    window.addEventListener("storage", sync);
    window.addEventListener("tl-auth-token", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("tl-auth-token", sync);
    };
  }, []);

  const token = window.AuthSDK?.getAccessToken?.();
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
