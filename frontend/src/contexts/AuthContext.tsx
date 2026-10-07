import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth as useClerkAuth } from "@clerk/react";

import { ApiError, apiRequest, clearCsrfToken, setAuthTokenProvider, setUnauthorizedHandler } from "@/lib/api";

export type UserRole = "admin" | "organizer" | "participant" | "user";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  mfaEnabled: boolean;
  mfaRequired: boolean;
}

interface AuthResponse {
  user: AuthUser;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isInitialized: boolean;
  authError: string | null;
  login: (email: string, password: string, mfaCode?: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  retryBootstrap: () => void;
  isAdmin: boolean;
  isStaff: boolean;
  isParticipant: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// These queries only use public endpoints. Keep them (including in-flight
// requests) when a guest bootstrap or an expired session returns 401.
const publicQueryKeys = new Set([
  "events", "event-search", "public-product-listings", "public-event-results",
  "public-standings", "public-number-list",
]);

function clearAccountCache(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.removeQueries({ predicate: (query) => !publicQueryKeys.has(String(query.queryKey[0])) });
  queryClient.getMutationCache().clear();
}

function LegacyAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    clearCsrfToken();
    // Clear private data without detaching active public query observers.
    clearAccountCache(queryClient);
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
        setAuthError(error instanceof Error ? error.message : "Could not connect to SportPass");
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

  const login = useCallback(async (email: string, password: string, mfaCode?: string) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, ...(mfaCode ? { mfa_code: mfaCode } : {}) }),
      });
      clearAccountCache(queryClient);
      setUser(response.user);
      setIsInitialized(true);
      return response.user;
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

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

function ClerkAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearSession = useCallback(() => {
    setUser(null);
    setAuthTokenProvider(null);
    clearAccountCache(queryClient);
  }, [queryClient]);

  const bootstrap = useCallback(async () => {
    if (!isLoaded) return;
    setIsLoading(true);
    setAuthError(null);
    if (!isSignedIn) {
      clearSession();
      setIsLoading(false);
      return;
    }
    setAuthTokenProvider(getToken);
    try {
      const response = await apiRequest<AuthResponse>("/auth/me");
      setUser(response.user);
    } catch (error) {
      clearSession();
      if (!(error instanceof ApiError) || error.status !== 401) setAuthError(error instanceof Error ? error.message : "Could not connect to SportPass");
    } finally {
      setIsLoading(false);
    }
  }, [clearSession, getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    void bootstrap();
    return () => { setUnauthorizedHandler(null); setAuthTokenProvider(null); };
  }, [bootstrap, clearSession]);

  const logout = useCallback(async () => { setIsLoading(true); try { await signOut(); } finally { clearSession(); setIsLoading(false); } }, [clearSession, signOut]);
  const value: AuthContextType = {
    user, isLoading: isLoading || !isLoaded, isInitialized: isLoaded, authError,
    login: async () => { throw new Error("Use Clerk sign-in"); }, logout,
    retryBootstrap: () => void bootstrap(), isAdmin: user?.role === "admin",
    isStaff: user?.role === "admin" || user?.role === "organizer",
    isParticipant: user?.role === "participant" || user?.role === "user",
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ? <ClerkAuthProvider>{children}</ClerkAuthProvider> : <LegacyAuthProvider>{children}</LegacyAuthProvider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
