import { Navigate, useLocation } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useAuth, UserRole } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { user, isInitialized, authError, retryBootstrap } = useAuth();
  const location = useLocation();

  if (!isInitialized) {
    return <Layout><div className="py-20 text-center text-muted-foreground">Checking your session…</div></Layout>;
  }

  if (authError && !user) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="mb-3 text-2xl font-bold">Unable to verify your session</h1>
          <p className="mb-6 text-sm text-muted-foreground">{authError}</p>
          <Button onClick={retryBootstrap}>Try again</Button>
        </div>
      </Layout>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === "admin" || user.role === "organizer" ? "/organizer" : "/dashboard"} replace />;
  }

  return <>{children}</>;
}
