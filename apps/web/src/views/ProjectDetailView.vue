<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  ArrowLeft,
  Check,
  FolderKanban,
  LoaderCircle,
  Save,
  Sparkles,
  Trash2,
} from "@lucide/vue";
import type {
  ProjectLifecycle,
  ProjectMemberRole,
  ProjectMemberSummary,
  ProjectSummary,
  TaskWorkspaceMember,
} from "@orbit/contracts";
import { projectApi } from "../lib/project-api";
import TaskManagementPanel from "../components/tasks/TaskManagementPanel.vue";

const route = useRoute();
const router = useRouter();
const project = ref<ProjectSummary | null>(null);
const name = ref("");
const description = ref("");
const state = ref<ProjectLifecycle>("PLANNING");
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const saved = ref(false);
const deleting = ref(false);
const members = ref<ProjectMemberSummary[]>([]);
const workspaceMembers = ref<TaskWorkspaceMember[]>([]);
const memberRoleDrafts = ref<Record<string, ProjectMemberRole>>({});
const membersLoading = ref(false);
const membersLoaded = ref(false);
const memberError = ref("");
const memberNotice = ref("");
const memberWorking = ref(false);
const newMemberUserId = ref("");
const newMemberRole = ref<ProjectMemberRole>("MEMBER");

const projectId = computed(() => String(route.params.projectId));
const availableWorkspaceMembers = computed(() => {
  const memberIds = new Set(members.value.map(({ userId }) => userId));
  return workspaceMembers.value.filter(({ id }) => !memberIds.has(id));
});
const stateLabels: Record<ProjectLifecycle, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

async function loadProject(): Promise<void> {
  const requestedProjectId = projectId.value;
  loading.value = true;
  error.value = "";
  membersLoaded.value = false;
  members.value = [];
  workspaceMembers.value = [];
  memberError.value = "";
  try {
    const response = await projectApi.get(requestedProjectId);
    if (requestedProjectId !== projectId.value) return;
    project.value = response.project;
    name.value = response.project.name;
    description.value = response.project.description ?? "";
    state.value = response.project.state;
    await loadProjectMembers(requestedProjectId);
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : "Could not load this project. Please try again.";
  } finally {
    loading.value = false;
  }
}

async function loadProjectMembers(requestedProjectId = projectId.value): Promise<boolean> {
  membersLoading.value = true;
  memberError.value = "";
  try {
    const response = await projectApi.listMembers(requestedProjectId);
    if (requestedProjectId !== projectId.value) return false;
    members.value = response.members;
    workspaceMembers.value = response.workspaceMembers;
    membersLoaded.value = true;
    memberRoleDrafts.value = Object.fromEntries(
      response.members.map((member) => [member.userId, member.projectRole]),
    );
    if (!response.workspaceMembers.some(({ id }) => id === newMemberUserId.value)) {
      newMemberUserId.value = "";
    }
    return true;
  } catch (caught) {
    if (requestedProjectId === projectId.value) {
      memberError.value =
        caught instanceof Error ? caught.message : "Could not load project members. Please try again.";
    }
    return false;
  } finally {
    if (requestedProjectId === projectId.value) membersLoading.value = false;
  }
}

function isLastProjectAdmin(member: ProjectMemberSummary): boolean {
  return (
    member.projectRole === "ADMIN" &&
    members.value.filter(({ projectRole }) => projectRole === "ADMIN").length === 1
  );
}

async function addProjectMember(): Promise<void> {
  if (!newMemberUserId.value) return;
  memberWorking.value = true;
  memberError.value = "";
  memberNotice.value = "";
  try {
    await projectApi.addMember(projectId.value, {
      userId: newMemberUserId.value,
      projectRole: newMemberRole.value,
    });
    newMemberUserId.value = "";
    if (await loadProjectMembers()) memberNotice.value = "Project member added.";
  } catch (caught) {
    memberError.value =
      caught instanceof Error ? caught.message : "Could not add this project member.";
  } finally {
    memberWorking.value = false;
  }
}

async function saveMemberRole(member: ProjectMemberSummary): Promise<void> {
  const projectRole = memberRoleDrafts.value[member.userId];
  if (!projectRole || projectRole === member.projectRole) return;
  memberWorking.value = true;
  memberError.value = "";
  memberNotice.value = "";
  try {
    await projectApi.updateMemberRole(projectId.value, member.userId, projectRole);
    if (await loadProjectMembers()) memberNotice.value = `Updated ${member.name}'s project role.`;
  } catch (caught) {
    memberError.value =
      caught instanceof Error ? caught.message : "Could not update this project member.";
  } finally {
    memberWorking.value = false;
  }
}

async function removeProjectMember(member: ProjectMemberSummary): Promise<void> {
  if (!window.confirm(`Remove ${member.name} from this project?`)) return;
  memberWorking.value = true;
  memberError.value = "";
  memberNotice.value = "";
  try {
    await projectApi.removeMember(projectId.value, member.userId);
    if (await loadProjectMembers()) memberNotice.value = `${member.name} was removed from the project.`;
  } catch (caught) {
    memberError.value =
      caught instanceof Error ? caught.message : "Could not remove this project member.";
  } finally {
    memberWorking.value = false;
  }
}

async function saveProject(): Promise<void> {
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    const response = await projectApi.update(projectId.value, {
      name: name.value,
      description: description.value,
      state: state.value,
    });
    project.value = response.project;
    name.value = response.project.name;
    description.value = response.project.description ?? "";
    state.value = response.project.state;
    saved.value = true;
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : "Could not save your changes. Please try again.";
  } finally {
    saving.value = false;
  }
}

async function deleteProject(): Promise<void> {
  if (!project.value) return;
  const confirmation = window.prompt(
    `This permanently deletes "${project.value.name}" and its tasks. Type the project name to confirm.`,
  );
  if (confirmation !== project.value.name) return;

  deleting.value = true;
  error.value = "";
  try {
    await projectApi.remove(projectId.value);
    await router.replace({ name: "projects" });
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : "Could not delete this project. Please try again.";
  } finally {
    deleting.value = false;
  }
}

watch(projectId, loadProject);
onMounted(loadProject);
</script>

<template>
  <section class="section-page project-detail-page">
    <RouterLink class="project-back-link" :to="{ name: 'projects' }">
      <ArrowLeft :size="15" /> All projects
    </RouterLink>

    <div v-if="loading" class="project-loading" role="status">
      <LoaderCircle class="project-spinner" :size="20" /> Loading project…
    </div>
    <div v-else-if="project" class="project-detail-content">
      <header class="projects-heading project-detail-heading">
        <div>
          <p class="eyebrow">{{ project.workspace.name }} / PROJECT</p>
          <h1>{{ project.name }}</h1>
          <p class="page-subtitle">Project details and workflow setup.</p>
        </div>
        <span class="project-state" :class="`project-state--${project.state.toLowerCase()}`">
          {{ stateLabels[project.state] }}
        </span>
      </header>

      <form class="project-detail-grid" @submit.prevent="saveProject">
        <div class="project-detail-main">
          <section class="project-create-panel">
            <div class="project-create-heading">
              <span class="project-create-icon"><FolderKanban :size="18" /></span>
              <div>
                <h2>Project details</h2>
                <p>Keep the project name and purpose up to date.</p>
              </div>
            </div>
            <label class="project-field">
              <span>Project name</span>
              <input v-model="name" name="name" minlength="2" maxlength="100" :disabled="!project.canManage" required />
            </label>
            <label class="project-field">
              <span>Description</span>
              <textarea
                v-model="description"
                name="description"
                maxlength="2000"
                rows="5"
                :disabled="!project.canManage"
                placeholder="What are you working toward?"
              ></textarea>
            </label>
            <label class="project-field">
              <span>Project status</span>
              <select v-model="state" name="state" :disabled="!project.canManage">
                <option v-for="(label, value) in stateLabels" :key="value" :value="value">
                  {{ label }}
                </option>
              </select>
            </label>
            <p v-if="error" class="project-error" role="alert">{{ error }}</p>
            <p v-if="saved" class="project-saved" role="status">
              <Check :size="15" /> Changes saved.
            </p>
            <div class="project-form-actions project-detail-actions">
              <button
                v-if="project.canManage"
                class="button button--danger"
                type="button"
                :disabled="deleting"
                @click="deleteProject"
              >
                <LoaderCircle v-if="deleting" class="project-spinner" :size="15" />
                <Trash2 v-else :size="15" />
                {{ deleting ? "Deleting..." : "Delete project" }}
              </button>
              <button v-if="project.canManage" class="button button--primary" type="submit" :disabled="saving">
                <LoaderCircle v-if="saving" class="project-spinner" :size="15" />
                <Save v-else :size="15" />
                {{ saving ? "Saving..." : "Save changes" }}
              </button>
              <p v-else class="workspace-permission-note">Only workspace admins and project admins can edit this project.</p>
            </div>
          </section>
        </div>

        <aside class="project-detail-aside">
          <section class="project-create-panel project-workflow-panel">
            <p class="eyebrow">WORKFLOW</p>
            <h2>Project statuses</h2>
            <p class="project-aside-copy">Use the project board to organize tasks by status.</p>
            <ol class="project-status-list">
              <li v-for="status in project.statuses" :key="status.id">
                <span class="project-status-dot" :style="{ backgroundColor: status.color }"></span>
                <span>{{ status.name }}</span>
              </li>
            </ol>
          </section>
          <section class="project-create-panel project-workflow-panel">
            <p class="eyebrow">PROJECT ACTIVITY</p>
            <h2>{{ project.taskCount }} tasks</h2>
            <p class="project-aside-copy">Tasks, comments, labels, and dependencies are available below.</p>
            <span class="project-aside-note"><Sparkles :size="14" /> Project data is saved.</span>
          </section>
        </aside>
      </form>
      <section class="project-create-panel project-members-panel" aria-labelledby="project-members-title">
        <div class="project-create-heading">
          <span class="project-create-icon"><FolderKanban :size="18" /></span>
          <div>
            <h2 id="project-members-title">Project members</h2>
            <p>Manage project roles for people in this workspace.</p>
          </div>
        </div>

        <p class="project-members-note">
          Project visibility remains shared with workspace members. Project roles control who can
          manage this project.
        </p>

        <div v-if="membersLoading" class="project-members-loading" role="status">
          <LoaderCircle class="project-spinner" :size="16" /> Loading project members…
        </div>
        <ul v-else-if="members.length" class="project-member-list" aria-label="Project members">
          <li v-for="member in members" :key="member.userId" class="project-member-row">
            <div class="project-member-identity">
              <strong>{{ member.name }}</strong>
              <span>{{ member.email }}</span>
            </div>
            <div class="project-member-actions">
              <template v-if="project.canManage">
                <label class="sr-only" :for="`project-role-${member.userId}`">
                  Role for {{ member.name }}
                </label>
                <select
                  :id="`project-role-${member.userId}`"
                  v-model="memberRoleDrafts[member.userId]"
                  :disabled="memberWorking || (isLastProjectAdmin(member) && member.projectRole === 'ADMIN')"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <button
                  v-if="memberRoleDrafts[member.userId] !== member.projectRole"
                  class="button button--quiet project-member-action"
                  type="button"
                  :disabled="memberWorking"
                  :aria-label="`Save role for ${member.name}`"
                  @click="saveMemberRole(member)"
                >
                  Save role
                </button>
                <button
                  class="button button--quiet project-member-action"
                  type="button"
                  :disabled="memberWorking || isLastProjectAdmin(member)"
                  :aria-label="`Remove ${member.name} from project`"
                  @click="removeProjectMember(member)"
                >
                  <Trash2 :size="14" /> Remove
                </button>
              </template>
              <span v-else class="project-member-role">{{ member.projectRole === "ADMIN" ? "Admin" : "Member" }}</span>
            </div>
          </li>
        </ul>
        <p v-else-if="!memberError" class="project-members-empty">No project members yet.</p>

        <p v-if="project.canManage && membersLoaded && members.length" class="project-members-note">
          A project must keep at least one project admin.
        </p>
        <button
          v-if="memberError && !membersLoaded"
          class="button button--quiet project-members-retry"
          type="button"
          :disabled="membersLoading"
          @click="loadProjectMembers()"
        >
          Retry loading members
        </button>
        <form v-if="project.canManage && membersLoaded" class="project-member-add-form" @submit.prevent="addProjectMember">
          <label class="project-field">
            <span>Add a workspace member</span>
            <select v-model="newMemberUserId" :disabled="memberWorking || membersLoading || !availableWorkspaceMembers.length">
              <option value="">Select a workspace member</option>
              <option v-for="workspaceMember in availableWorkspaceMembers" :key="workspaceMember.id" :value="workspaceMember.id">
                {{ workspaceMember.name }} ({{ workspaceMember.email }})
              </option>
            </select>
          </label>
          <label class="project-field">
            <span>Project role</span>
            <select v-model="newMemberRole" :disabled="memberWorking || membersLoading || !availableWorkspaceMembers.length">
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          <button class="button button--primary" type="submit" :disabled="memberWorking || membersLoading || !newMemberUserId">
            {{ memberWorking ? "Saving…" : "Add member" }}
          </button>
          <p v-if="!membersLoading && membersLoaded && !availableWorkspaceMembers.length" class="project-members-empty">
            All workspace members already belong to this project.
          </p>
        </form>
        <p v-if="memberError" class="project-error" role="alert">{{ memberError }}</p>
        <p v-if="memberNotice" class="project-saved" role="status">{{ memberNotice }}</p>
        <p v-if="!project.canManage" class="workspace-permission-note">
          Only workspace owners, workspace admins, and project admins can manage project members.
        </p>
      </section>
      <TaskManagementPanel :project="project" />
    </div>
    <div v-else class="project-error-state">
      <p class="project-error" role="alert">{{ error || "Project could not be found." }}</p>
      <RouterLink class="button button--quiet" :to="{ name: 'projects' }">
        Return to projects
      </RouterLink>
    </div>
  </section>
</template>
