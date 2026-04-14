import { create } from 'zustand';

interface User {
  id: string;
  email: string;
  name?: string;
  plan?: string;
  usageCount?: number;
}

interface AuthState {
  user: User | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any | null;
  setUser: (user: User | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSession: (session: any | null) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  setUser: (user) => set({ user }),
  setSession: (session) => set({ session }),
  signOut: () => set({ user: null, session: null }),
}));
