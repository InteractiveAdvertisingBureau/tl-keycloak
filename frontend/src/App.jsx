import { Routes, Route, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import PortalPage from "./pages/PortalPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import SignupPage from "./pages/SignupPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import UnauthorizedPage from "./pages/UnauthorizedPage.jsx";
import ProtectedOutlet from "./layouts/ProtectedOutlet.jsx";
import PortalLayout from "./layouts/PortalLayout.jsx";
import HomeRedirect from "./routes/HomeRedirect.jsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<ProtectedOutlet />}>
        <Route element={<PortalLayout />}>
          <Route path="/portal" element={<PortalPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
        </Route>
      </Route>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
