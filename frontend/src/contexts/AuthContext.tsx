import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError, apiRequest, setUnauthorizedHandler } from "@/lib/api";

export type UserRole = "admin" | "organizer" | "participant" | "user";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
}

interface AuthResponse {
  user: AuthUser;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isInitialized: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  retryBootstrap: () => void;
  isAdmin: boolean;
  isStaff: boolean;
  isParticipant: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    queryClient.removeQueries({ queryKey: ["participant-registrations"] });
  }, [queryClient]);

  const bootstrap = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const response = await apiRequest<AuthResponse>("/auth/me");
      setUser(response.user);
    } catch (error) {
      clearSession();
      if (!(error instanceof ApiError) || error.status !== 401) {
        setAuthError(error instanceof Error ? error.message : "Could not connect to RacePass");
      }
    } finally {
      setIsLoading(false);
      setIsInitialized(true);
    }
  }, [clearSession]);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    void bootstrap();
    return () => setUnauthorizedHandler(null);
  }, [bootstrap, clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUser(response.user);
      setIsInitialized(true);
      return response.user;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await apiRequest<{ status: string }>("/auth/logout", { method: "POST" });
    } finally {
      clearSession();
      setIsLoading(false);
    }
  }, [clearSession]);

  const isAdmin = user?.role === "admin";
  const isStaff = user?.role === "admin" || user?.role === "organizer";
  const isParticipant = user?.role === "participant" || user?.role === "user";

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isInitialized,
      authError,
      login,
      logout,
      retryBootstrap: () => void bootstrap(),
      isAdmin,
      isStaff,
      isParticipant,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
