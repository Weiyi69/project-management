import { defineStore } from "pinia";
import { ref } from "vue";
import type { AuthenticatedUser } from "@orbit/contracts";
import { AuthApiError, authApi } from "../lib/auth-api";
import { useWorkspaceStore } from "./workspaces";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<AuthenticatedUser | null>(null);
  const initialized = ref(false);
  const error = ref("");
  let initializationPromise: Promise<void> | undefined;

  async function initialize(): Promise<void> {
    if (initialized.value) {
      return;
    }
    if (initializationPromise) {
      return initializationPromise;
    }

    initializationPromise = (async () => {
      try {
        const response = await authApi.currentUser();
        user.value = response.user;
        error.value = "";
      } catch (caught) {
        if (caught instanceof AuthApiError && caught.status === 401) {
          user.value = null;
          error.value = "";
        } else {
          error.value =
            caught instanceof Error
              ? caught.message
              : "Could not verify your session. Please try again.";
          throw caught;
        }
      } finally {
        initialized.value = true;
        initializationPromise = undefined;
      }
    })();

    return initializationPromise;
  }

  async function register(input: { name: string; email: string; password: string }) {
    error.value = "";
    try {
      return await authApi.register(input);
    } catch (caught) {
      error.value =
        caught instanceof Error ? caught.message : "Could not create your account.";
      throw caught;
    }
  }

  async function login(input: { email: string; password: string }): Promise<void> {
    error.value = "";
    try {
      const response = await authApi.login(input);
      useWorkspaceStore().reset();
      user.value = response.user;
      initialized.value = true;
    } catch (caught) {
      error.value =
        caught instanceof Error ? caught.message : "Could not sign in.";
      throw caught;
    }
  }

  async function logout(): Promise<void> {
    error.value = "";
    try {
      await authApi.logout();
      useWorkspaceStore().reset();
      user.value = null;
      initialized.value = true;
    } catch (caught) {
      error.value =
        caught instanceof Error ? caught.message : "Could not sign out.";
      throw caught;
    }
  }

  async function refreshCurrentUser(): Promise<void> {
    const response = await authApi.currentUser();
    user.value = response.user;
    initialized.value = true;
  }

  function expireSession(): void {
    useWorkspaceStore().reset();
    user.value = null;
    initialized.value = true;
    error.value = "";
  }

  function clearError(): void {
    error.value = "";
  }

  return {
    user,
    initialized,
    error,
    initialize,
    register,
    login,
    logout,
    refreshCurrentUser,
    expireSession,
    clearError,
  };
});
