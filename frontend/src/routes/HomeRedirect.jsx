import { Navigate } from "react-router-dom";

export default function HomeRedirect() {
  const token = window.AuthSDK?.getAccessToken?.();
  return <Navigate to={token ? "/portal" : "/login"} replace />;
}
