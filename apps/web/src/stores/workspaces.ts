import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  InvitationSummary,
  WorkspaceMemberSummary,
  WorkspaceSummary,
} from "@orbit/contracts";
import { workspaceApi } from "../lib/workspace-api";

const STORAGE_KEY = "orbit.selectedWorkspace";

export const useWorkspaceStore = defineStore("workspaces", () => {
  const workspaces = ref<WorkspaceSummary[]>([]);
  const selectedId = ref("");
  const initialized = ref(false);
  const busy = ref(false);
  const error = ref("");
  let loadPromise: Promise<void> | undefined;
  let loadGeneration = 0;
  const active = computed(
    () => workspaces.value.find((workspace) => workspace.id === selectedId.value) ?? null,
  );
  const canManage = computed(() => active.value?.role === "OWNER" || active.value?.role === "ADMIN");
  const isOwner = computed(() => active.value?.role === "OWNER");

  async function load(preferredId?: string, force = false): Promise<void> {
    if (initialized.value && !force) return;
    if (loadPromise) return loadPromise;

    const generation = ++loadGeneration;
    busy.value = true;
    error.value = "";
    const pending = (async () => {
      try {
        const loadedWorkspaces = await workspaceApi.list();
        if (generation !== loadGeneration) return;
        workspaces.value = loadedWorkspaces;
        const savedId = sessionStorage.getItem(STORAGE_KEY);
        const candidate = preferredId || selectedId.value || savedId;
        selectedId.value = workspaces.value.some((workspace) => workspace.id === candidate)
          ? candidate!
          : workspaces.value[0]?.id ?? "";
        if (selectedId.value) sessionStorage.setItem(STORAGE_KEY, selectedId.value);
        else sessionStorage.removeItem(STORAGE_KEY);
        initialized.value = true;
      } catch (caught) {
        if (generation === loadGeneration) {
          error.value = caught instanceof Error ? caught.message : "Could not load workspaces.";
        }
        throw caught;
      } finally {
        if (generation === loadGeneration) {
          busy.value = false;
          loadPromise = undefined;
        }
      }
    })();

    loadPromise = pending;
    return pending;
  }

  function select(id: string): void {
    if (!workspaces.value.some((workspace) => workspace.id === id)) {
      throw new Error("That workspace is not available to your account.");
    }
    selectedId.value = id;
    sessionStorage.setItem(STORAGE_KEY, id);
  }

  function reset(): void {
    loadGeneration += 1;
    workspaces.value = [];
    selectedId.value = "";
    initialized.value = false;
    busy.value = false;
    error.value = "";
    loadPromise = undefined;
    sessionStorage.removeItem(STORAGE_KEY);
  }

  async function create(name: string): Promise<WorkspaceSummary> {
    error.value = "";
    const created = await workspaceApi.create(name);
    workspaces.value.push(created);
    select(created.id);
    return created;
  }

  async function update(name: string): Promise<void> {
    if (!active.value) throw new Error("Select a workspace first.");
    error.value = "";
    const updated = await workspaceApi.update(active.value.id, name);
    workspaces.value = workspaces.value.map((workspace) =>
      workspace.id === updated.id ? updated : workspace,
    );
  }

  async function remove(): Promise<void> {
    if (!active.value) throw new Error("Select a workspace first.");
    const removedId = active.value.id;
    error.value = "";
    await workspaceApi.remove(removedId);
    workspaces.value = workspaces.value.filter((workspace) => workspace.id !== removedId);
    selectedId.value = workspaces.value[0]?.id ?? "";
    if (selectedId.value) sessionStorage.setItem(STORAGE_KEY, selectedId.value);
    else sessionStorage.removeItem(STORAGE_KEY);
  }

  async function members(): Promise<WorkspaceMemberSummary[]> {
    if (!active.value) throw new Error("Select a workspace first.");
    return workspaceApi.members(active.value.id);
  }

  async function invitations(): Promise<InvitationSummary[]> {
    if (!active.value) throw new Error("Select a workspace first.");
    return workspaceApi.invitations(active.value.id);
  }

  async function invite(email: string, role: "ADMIN" | "MEMBER"): Promise<InvitationSummary> {
    if (!active.value) throw new Error("Select a workspace first.");
    return workspaceApi.invite(active.value.id, email, role);
  }

  async function revokeInvitation(invitationId: string): Promise<void> {
    if (!active.value) throw new Error("Select a workspace first.");
    await workspaceApi.revokeInvitation(active.value.id, invitationId);
  }

  return {
    workspaces,
    selectedId,
    active,
    canManage,
    isOwner,
    initialized,
    busy,
    error,
    load,
    select,
    reset,
    create,
    update,
    remove,
    members,
    invitations,
    invite,
    revokeInvitation,
  };
});
