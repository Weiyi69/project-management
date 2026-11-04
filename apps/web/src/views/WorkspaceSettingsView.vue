<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  MailPlus,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserMinus,
  UsersRound,
} from "@lucide/vue";
import type { InvitationSummary, WorkspaceMemberSummary } from "@orbit/contracts";
import { useAuthStore } from "../stores/auth";
import { WorkspaceApiError, workspaceApi } from "../lib/workspace-api";
import { useWorkspaceStore } from "../stores/workspaces";

const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const members = ref<WorkspaceMemberSummary[]>([]);
const invitations = ref<InvitationSummary[]>([]);
const workspaceName = ref("");
const newWorkspaceName = ref("");
const inviteEmail = ref("");
const inviteRole = ref<"ADMIN" | "MEMBER">("MEMBER");
const loading = ref(true);
const saving = ref(false);
const inviting = ref(false);
const error = ref("");
const notice = ref("");
const selectedWorkspace = computed(() => workspaces.active);

function canManageMember(member: WorkspaceMemberSummary): boolean {
  if (!workspaces.canManage || member.role === "OWNER") return false;
  return workspaces.isOwner || (member.role === "MEMBER" && member.userId !== auth.user?.id);
}

async function loadDetails(): Promise<void> {
  const active = workspaces.active;
  if (!active) {
    members.value = [];
    invitations.value = [];
    workspaceName.value = "";
    return;
  }

  workspaceName.value = active.name;
  try {
    members.value = await workspaceApi.members(active.id);
    invitations.value = workspaces.canManage ? await workspaceApi.invitations(active.id) : [];
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load workspace details.";
  }
}

async function initialize(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    await workspaces.load(auth.user?.workspaceId, true);
    await loadDetails();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load workspaces.";
  } finally {
    loading.value = false;
  }
}

async function createWorkspace(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await workspaces.create(newWorkspaceName.value);
    newWorkspaceName.value = "";
    await loadDetails();
    notice.value = "Workspace created.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not create workspace.";
  } finally {
    saving.value = false;
  }
}

async function renameWorkspace(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await workspaces.update(workspaceName.value);
    notice.value = "Workspace name updated.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not update workspace.";
  } finally {
    saving.value = false;
  }
}

async function deleteWorkspace(): Promise<void> {
  const active = workspaces.active;
  if (!active || !window.confirm(`Delete "${active.name}"? Workspaces with projects cannot be deleted.`)) {
    return;
  }

  error.value = "";
  notice.value = "";
  try {
    await workspaces.remove();
    await loadDetails();
    notice.value = "Workspace deleted.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not delete workspace.";
  }
}

async function sendInvitation(): Promise<void> {
  inviting.value = true;
  error.value = "";
  notice.value = "";
  try {
    await workspaces.invite(inviteEmail.value, inviteRole.value);
    inviteEmail.value = "";
    invitations.value = await workspaces.invitations();
    notice.value = "Invitation created. The recipient’s notification preferences are respected.";
  } catch (caught) {
    error.value =
      caught instanceof WorkspaceApiError && caught.status === 503
        ? `${caught.message} Configure SMTP in the API environment.`
        : caught instanceof Error
          ? caught.message
          : "Could not send the invitation.";
  } finally {
    inviting.value = false;
  }
}

async function changeRole(member: WorkspaceMemberSummary, event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  if (value !== "ADMIN" && value !== "MEMBER") return;
  error.value = "";
  try {
    await workspaceApi.updateMember(workspaces.selectedId, member.userId, value);
    members.value = await workspaceApi.members(workspaces.selectedId);
    notice.value = `${member.name}'s role updated.`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not update member role.";
  }
}

async function removeMember(member: WorkspaceMemberSummary): Promise<void> {
  if (!window.confirm(`Remove ${member.name} from ${selectedWorkspace.value?.name}?`)) return;
  error.value = "";
  try {
    await workspaceApi.removeMember(workspaces.selectedId, member.userId);
    await loadDetails();
    if (member.userId === auth.user?.id) await workspaces.load(undefined, true);
    notice.value = `${member.name} was removed from the workspace.`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not remove workspace member.";
  }
}

async function revokeInvitation(invitation: InvitationSummary): Promise<void> {
  if (!selectedWorkspace.value || !window.confirm(`Revoke the invitation for ${invitation.email}?`)) {
    return;
  }
  error.value = "";
  try {
    await workspaces.revokeInvitation(invitation.id);
    invitations.value = await workspaces.invitations();
    notice.value = "Invitation revoked.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not revoke invitation.";
  }
}

watch(() => workspaces.selectedId, () => {
  error.value = "";
  notice.value = "";
  void loadDetails();
});

onMounted(initialize);
</script>

<template>
  <section class="section-page workspace-settings-page">
    <header class="projects-heading">
      <div>
        <p class="eyebrow">WORKSPACE AND PEOPLE</p>
        <h1>Workspace settings</h1>
        <p class="page-subtitle">Manage workspaces, member access, and invitations.</p>
      </div>
      <label v-if="workspaces.workspaces.length > 1" class="workspace-select-label">
        <span class="sr-only">Current workspace</span>
        <select
          :value="workspaces.selectedId"
          aria-label="Select workspace"
          @change="
            workspaces.select(($event.target as HTMLSelectElement).value);
            loadDetails();
          "
        >
          <option v-for="workspace in workspaces.workspaces" :key="workspace.id" :value="workspace.id">
            {{ workspace.name }} · {{ workspace.role.toLowerCase() }}
          </option>
        </select>
        <ChevronDown :size="14" />
      </label>
    </header>

    <div v-if="error" class="project-error" role="alert">{{ error }}</div>
    <p v-if="notice" class="project-saved" role="status"><Check :size="15" /> {{ notice }}</p>
    <div v-if="loading" class="project-loading" role="status">
      <LoaderCircle class="project-spinner" :size="20" /> Loading workspace settings…
    </div>

    <template v-else>
      <section class="project-create-panel workspace-settings-panel">
        <div class="project-create-heading">
          <span class="project-create-icon"><UsersRound :size="18" /></span>
          <div>
            <h2>Your workspaces</h2>
            <p>Create another workspace or update the selected one.</p>
          </div>
        </div>
        <form class="workspace-create-form" @submit.prevent="createWorkspace">
          <label class="project-field">
            <span>New workspace name</span>
            <input
              v-model="newWorkspaceName"
              name="newWorkspaceName"
              minlength="2"
              maxlength="80"
              placeholder="e.g. Product team"
              required
            />
          </label>
          <button class="button button--primary" type="submit" :disabled="saving">
            <Plus :size="15" /> Create workspace
          </button>
        </form>

        <div v-if="selectedWorkspace" class="workspace-settings-current">
          <div>
            <p class="eyebrow">SELECTED WORKSPACE</p>
            <strong>{{ selectedWorkspace.name }}</strong>
            <span>Your role: {{ selectedWorkspace.role.toLowerCase() }}</span>
          </div>
          <form v-if="workspaces.isOwner" class="workspace-rename-form" @submit.prevent="renameWorkspace">
            <label class="project-field">
              <span>Workspace name</span>
              <input v-model="workspaceName" name="workspaceName" minlength="2" maxlength="80" required />
            </label>
            <button class="button button--quiet" type="submit" :disabled="saving">
              <RefreshCw :size="14" /> Rename
            </button>
            <button class="button button--danger" type="button" @click="deleteWorkspace">
              <Trash2 :size="14" /> Delete
            </button>
          </form>
          <p v-else class="workspace-permission-note">
            Only the workspace owner can rename or delete this workspace.
          </p>
        </div>
      </section>

      <section v-if="selectedWorkspace" class="project-create-panel workspace-settings-panel">
        <div class="project-create-heading">
          <span class="project-create-icon"><Shield :size="18" /></span>
          <div>
            <h2>Members and roles</h2>
            <p>Owners control admins; owners and admins can manage members.</p>
          </div>
        </div>
        <ul class="workspace-member-list">
          <li v-for="member in members" :key="member.userId" class="workspace-member">
            <span class="user-avatar user-avatar--small" aria-hidden="true">
              {{ member.name.trim().charAt(0).toUpperCase() }}
            </span>
            <span class="workspace-member-copy">
              <strong>{{ member.name }}<span v-if="member.userId === auth.user?.id"> (you)</span></strong>
              <span>{{ member.email }}</span>
            </span>
            <span v-if="member.role === 'OWNER'" class="workspace-role-badge">Owner</span>
            <template v-else-if="canManageMember(member)">
              <select
                :value="member.role"
                :aria-label="`Role for ${member.name}`"
                @change="changeRole(member, $event)"
              >
                <option value="MEMBER">Member</option>
                <option v-if="workspaces.isOwner" value="ADMIN">Admin</option>
              </select>
              <button
                class="icon-button workspace-remove-button"
                type="button"
                :aria-label="`Remove ${member.name}`"
                @click="removeMember(member)"
              >
                <UserMinus :size="15" />
              </button>
            </template>
            <span v-else class="workspace-role-badge">{{ member.role.toLowerCase() }}</span>
          </li>
        </ul>
      </section>

      <section v-if="selectedWorkspace && workspaces.canManage" class="project-create-panel workspace-settings-panel">
        <div class="project-create-heading">
          <span class="project-create-icon"><MailPlus :size="18" /></span>
          <div>
            <h2>Invite someone</h2>
            <p>ORBIT emails a secure, seven-day invitation link.</p>
          </div>
        </div>
        <form class="workspace-invite-form" @submit.prevent="sendInvitation">
          <label class="project-field">
            <span>Email address</span>
            <input v-model="inviteEmail" name="inviteEmail" type="email" maxlength="254" required />
          </label>
          <label class="project-field">
            <span>Role</span>
            <select v-model="inviteRole" name="inviteRole">
              <option value="MEMBER">Member</option>
              <option v-if="workspaces.isOwner" value="ADMIN">Admin</option>
            </select>
          </label>
          <button class="button button--primary" type="submit" :disabled="inviting">
            <LoaderCircle v-if="inviting" class="project-spinner" :size="15" />
            <MailPlus v-else :size="15" />
            {{ inviting ? "Sending..." : "Send invitation" }}
          </button>
        </form>
        <ul v-if="invitations.length" class="workspace-invitation-list">
          <li
            v-for="invitation in invitations"
            :key="invitation.id"
            class="workspace-member workspace-invitation"
          >
            <span class="workspace-member-copy">
              <strong>{{ invitation.email }}</strong>
              <span>
                {{ invitation.acceptedAt ? "Accepted" : invitation.expired ? "Expired" : "Pending" }}
                · {{ invitation.role.toLowerCase() }} · expires
                {{ new Date(invitation.expiresAt).toLocaleDateString() }}
              </span>
            </span>
            <button
              v-if="!invitation.acceptedAt"
              class="button button--quiet workspace-invitation-revoke"
              type="button"
              @click="revokeInvitation(invitation)"
            >
              <Trash2 :size="13" /> Revoke
            </button>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>
