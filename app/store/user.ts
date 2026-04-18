import { create } from "zustand";
import { persist } from "zustand/middleware";
import { StoreKey } from "../constant";

interface UserState {
  id: string;
  username: string;
  loggedIn: boolean;
  login: (id: string, username: string) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      id: "",
      username: "",
      loggedIn: false,
      login: (id, username) => set({ id, username, loggedIn: true }),
      logout: () => set({ id: "", username: "", loggedIn: false }),
    }),
    { name: StoreKey.User },
  ),
);
