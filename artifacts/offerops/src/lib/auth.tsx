import { createContext, useContext, useEffect, useState } from "react";
import { Employee, login as apiLogin, LoginBody, logout as apiLogout } from "@workspace/api-client-react";
import { useLocation } from "wouter";

type Session = {
  employee: Employee;
  token: string;
};

type AuthContextType = {
  currentEmployee: Employee | null;
  token: string | null;
  login: (body: LoginBody) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    try {
      const stored = localStorage.getItem("offerops_session");
      if (stored) {
        setSession(JSON.parse(stored));
      }
    } catch (e) {
      // ignore
    }
    setIsLoading(false);
  }, []);

  const login = async (body: LoginBody) => {
    const data = await apiLogin(body);
    const newSession = { employee: data.employee, token: data.token };
    localStorage.setItem("offerops_session", JSON.stringify(newSession));
    setSession(newSession);
    
    setLocation("/ops");
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (e) {
      // ignore
    }
    localStorage.removeItem("offerops_session");
    setSession(null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider value={{ 
      currentEmployee: session?.employee ?? null, 
      token: session?.token ?? null, 
      login, 
      logout,
      isLoading
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
