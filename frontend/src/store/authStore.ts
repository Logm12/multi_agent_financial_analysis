/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { create } from 'zustand';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
}

interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  checkAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, fullName: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

// Helper to get baseUrl — fallback to localhost:8001 if env var not set
const API_URL = import.meta.env.VITE_API_URL 
  || (import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace('/api/v1', '') : '')
  || 'http://localhost:8001';

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  clearError: () => set({ error: null }),

  checkAuth: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/me`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        const data = await response.json();
        set({ user: data, isAuthenticated: true, isLoading: false });
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch (err: any) {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.status === 'success') {
        set({ user: data.user, isAuthenticated: true, isLoading: false });
        return true;
      } else {
        set({ 
          error: data.detail || data.message || 'Incorrect email or password.', 
          isAuthenticated: false, 
          isLoading: false 
        });
        return false;
      }
    } catch (err: any) {
      set({ error: 'Connection error. Please try again.', isLoading: false });
      return false;
    }
  },

  register: async (email, password, fullName) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, full_name: fullName }),
      });
      
      const data = await response.json();
      
      if (response.ok && data.status === 'success') {
        set({ isLoading: false });
        return true;
      } else {
        set({ 
          error: data.detail || data.message || 'Registration failed.', 
          isLoading: false 
        });
        return false;
      }
    } catch (err: any) {
      set({ error: 'Connection error. Please try again.', isLoading: false });
      return false;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    // Fire-and-forget background logout API request
    fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch((err) => {
      console.error('Logout request failed:', err);
    });

    window.location.hash = '/login';
    localStorage.setItem('logout-event', Date.now().toString());
    set({ user: null, isAuthenticated: false, isLoading: false });
  },
}));
