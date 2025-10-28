import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiRequest } from '@/lib/queryClient';

interface User {
  userId: string;
  email: string;
  name: string;
  role: 'master' | 'consultor' | 'cliente';
  organizationId: string;
  clientIds: string[];
  managedConsultantIds?: string[];
  managedClientIds?: string[];
  managerId?: string;
  consultantId?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Verificar autenticação ao carregar
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Erro ao verificar autenticação:', error);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    console.log('[AuthContext] login() called with email:', email);
    try {
      const res = await apiRequest('POST', '/api/auth/login', { email, password });
      console.log('[AuthContext] API request completed, status:', res.status);
      const data = await res.json();
      console.log('[AuthContext] Response data:', data);
      setUser(data.user);
      console.log('[AuthContext] User state updated');
    } catch (error) {
      console.error('[AuthContext] Login error:', error);
      throw error;
    }
  };

  const register = async (email: string, password: string, name: string) => {
    console.log('[AuthContext] register() called with email:', email);
    try {
      const res = await apiRequest('POST', '/api/auth/register', {
        email,
        password,
        name,
        role: 'master',
      });
      console.log('[AuthContext] API request completed, status:', res.status);
      const data = await res.json();
      console.log('[AuthContext] Response data:', data);
      setUser(data.user);
      console.log('[AuthContext] User state updated');
    } catch (error) {
      console.error('[AuthContext] Register error:', error);
      throw error;
    }
  };

  const logout = async () => {
    await apiRequest('POST', '/api/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
