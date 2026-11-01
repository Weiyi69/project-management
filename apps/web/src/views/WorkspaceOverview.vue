<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  FolderKanban,
  FolderPlus,
  LoaderCircle,
  Sparkles,
  UsersRound,
  X,
} from "@lucide/vue";
import type {
  PendingWorkspaceInvitation,
  ProjectLifecycle,
  ProjectSummary,
  TaskFocusResponse,
  WorkspaceActivitySummary,
} from "@orbit/contracts";
import { activityApi } from "../lib/activity-api";
import { projectApi } from "../lib/project-api";
import { taskApi } from "../lib/task-api";
import { workspaceApi } from "../lib/workspace-api";
import { useAuthStore } from "../stores/auth";
import { useWorkspaceStore } from "../stores/workspaces";

const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const now = new Date();
const greeting = computed(() => {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
});
const dateLabel = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(now);
const localToday = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");

const loading = ref(true);
const pageError = ref("");
const taskFocus = ref<TaskFocusResponse | null>(null);
const tasksError = ref("");
const projects = ref<ProjectSummary[]>([]);
const projectsError = ref("");
const activities = ref<WorkspaceActivitySummary[]>([]);
const activityError = ref("");
const invitations = ref<PendingWorkspaceInvitation[]>([]);
const invitationError = ref("");
const invitationNotice = ref("");
const busyInvitationId = ref("");
const dashboardLoaded = ref(false);
let loadGeneration = 0;

const projectStates: Record<ProjectLifecycle, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};
const recentProjects = computed(() => projects.value.slice(0, 3));
const isEmptyWorkspace = computed(
  () =>
    dashboardLoaded.value &&
    !loading.value &&
    Boolean(workspaces.active) &&
    !projectsError.value &&
    projects.value.length === 0,
);
const taskProject = computed(() => recentProjects.value[0] ?? null);
const taskCreateTarget = computed(() =>
  taskProject.value
    ? {
        name: "project-detail",
        params: { projectId: taskProject.value.id },
        query: { createTask: "1" },
      }
    : { name: "projects", query: { create: "true", createTask: "1" } },
);

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

async function loadDashboard(): Promise<void> {
  const generation = ++loadGeneration;
  loading.value = true;
  pageError.value = "";
  tasksError.value = "";
  projectsError.value = "";
  activityError.value = "";
  invitationError.value = "";

  try {
    await workspaces.load();
  } catch (caught) {
    if (generation === loadGeneration) {
      pageError.value = message(caught, "Could not load your workspace.");
      loading.value = false;
    }
    return;
  }
  if (generation !== loadGeneration) return;

  const workspaceId = workspaces.active?.id;
  const results = await Promise.allSettled([
    taskApi.focus(localToday),
    workspaceId ? projectApi.list() : Promise.resolve({ projects: [] as ProjectSummary[] }),
    workspaceId
      ? activityApi.list(workspaceId)
      : Promise.resolve([] as WorkspaceActivitySummary[]),
    workspaceApi.pendingInvitations(),
  ]);
  if (generation !== loadGeneration) return;

  const [tasksResult, projectsResult, activityResult, invitationsResult] = results;
  if (tasksResult.status === "fulfilled") taskFocus.value = tasksResult.value;
  else tasksError.value = message(tasksResult.reason, "Could not load your tasks.");
  if (projectsResult.status === "fulfilled") projects.value = projectsResult.value.projects;
  else projectsError.value = message(projectsResult.reason, "Could not load workspace projects.");
  if (activityResult.status === "fulfilled") activities.value = activityResult.value;
  else activityError.value = message(activityResult.reason, "Could not load recent activity.");
  if (invitationsResult.status === "fulfilled") invitations.value = invitationsResult.value;
  else invitationError.value = message(invitationsResult.reason, "Could not load invitations.");

  loading.value = false;
  dashboardLoaded.value = true;
}

async function respondToInvitation(
  invitation: PendingWorkspaceInvitation,
  action: "accept" | "decline",
): Promise<void> {
  busyInvitationId.value = invitation.id;
  invitationError.value = "";
  invitationNotice.value = "";
  try {
    if (action === "accept") {
      await workspaceApi.acceptPendingInvitation(invitation.id);
      invitations.value = invitations.value.filter(({ id }) => id !== invitation.id);
      invitationNotice.value = `You joined ${invitation.workspaceName}.`;
      try {
        await workspaces.load(workspaces.selectedId, true);
      } catch (caught) {
        invitationError.value = `Invitation accepted, but the workspace list could not refresh: ${message(
          caught,
          "please reload the page.",
        )}`;
      }
    } else {
      await workspaceApi.declinePendingInvitation(invitation.id);
      invitations.value = invitations.value.filter(({ id }) => id !== invitation.id);
      invitationNotice.value = `Invitation to ${invitation.workspaceName} declined.`;
    }
  } catch (caught) {
    invitationError.value = message(caught, "Could not update this invitation.");
  } finally {
    busyInvitationId.value = "";
  }
}

function formatDueDate(value: string | null): string {
  if (!value) return "No due date";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(year!, month! - 1, day!),
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    PROJECT_CREATED: "created a project",
    PROJECT_UPDATED: "updated a project",
    PROJECT_MEMBER_ADDED: "added a project member",
    TASK_CREATED: "created a task",
    TASK_ASSIGNED: "assigned a task",
    TASK_COMPLETED: "completed a task",
    TASK_STATUS_CHANGED: "changed task status",
    TASK_PRIORITY_CHANGED: "changed task priority",
    TASK_COMMENTED: "commented on a task",
    WORKSPACE_MEMBER_ROLE_CHANGED: "updated a member role",
    WORKSPACE_MEMBER_REMOVED: "removed a member",
    WORKSPACE_MEMBER_JOINED: "joined the workspace",
  };
  return labels[action] ?? action.toLowerCase().replaceAll("_", " ");
}

function activityTarget(activity: WorkspaceActivitySummary) {
  if (activity.entityType === "TASK" && activity.project) {
    return {
      name: "project-detail",
      params: { projectId: activity.project.id },
      query: { task: activity.entityId },
    };
  }
  if (activity.entityType === "PROJECT") {
    return { name: "project-detail", params: { projectId: activity.entityId } };
  }
  if (activity.project) {
    return { name: "project-detail", params: { projectId: activity.project.id } };
  }
  return { name: "projects" };
}

onMounted(() => void loadDashboard());
watch(
  () => workspaces.selectedId,
  () => {
    if (dashboardLoaded.value && workspaces.initialized) void loadDashboard();
  },
);
</script>

<template>
  <div class="overview-page dashboard-page">
    <section class="page-heading">
      <div>
        <p class="eyebrow">{{ dateLabel }}<span v-if="workspaces.active"> · {{ workspaces.active.name }}</span></p>
        <h1>{{ greeting }}<span v-if="auth.user">, {{ auth.user.name.split(" ")[0] }}</span><span class="heading-period">.</span></h1>
        <p class="page-subtitle">A little space to do great work.</p>
      </div>
      <div class="dashboard-quick-actions">
        <RouterLink
          v-if="workspaces.canManage"
          class="button button--quiet"
          :to="{ name: 'projects', query: { create: 'true' } }"
          aria-label="Create a new project"
        >
          <FolderPlus :size="16" /> New project
        </RouterLink>
        <RouterLink
          v-if="taskProject || workspaces.canManage"
          class="button button--primary"
          :to="taskCreateTarget"
          aria-label="Create task"
        >
          <Check :size="16" /> Create task
        </RouterLink>
      </div>
    </section>

    <p v-if="pageError" class="dashboard-error" role="alert">{{ pageError }}</p>
    <p v-if="loading" class="dashboard-loading" role="status">
      <LoaderCircle class="project-spinner" :size="18" /> Loading your workspace overview…
    </p>

    <template v-else-if="!pageError">
      <section
        v-if="isEmptyWorkspace"
        class="dashboard-onboarding"
        aria-labelledby="dashboard-onboarding-title"
      >
        <span class="dashboard-onboarding-icon" aria-hidden="true">
          <Sparkles :size="20" />
        </span>
        <div class="dashboard-onboarding-copy">
          <p class="eyebrow">A FRESH START</p>
          <h2 id="dashboard-onboarding-title">Welcome to your workspace</h2>
          <p>
            Create your first project to bring your team's work together. Add tasks and invite
            teammates whenever you're ready.
          </p>
        </div>
        <div class="dashboard-onboarding-actions">
          <RouterLink
            v-if="workspaces.canManage"
            class="button button--primary"
            :to="{ name: 'projects', query: { create: 'true', onboarding: '1' } }"
            aria-label="Create your first project"
          >
            <FolderPlus :size="16" /> Create your first project
          </RouterLink>
          <RouterLink
            v-if="workspaces.canManage"
            class="button button--quiet"
            :to="{ name: 'settings' }"
            aria-label="Invite team members"
          >
            <UsersRound :size="16" /> Invite team members
          </RouterLink>
          <RouterLink
            class="dashboard-onboarding-browse"
            :to="{ name: 'projects' }"
            aria-label="Browse projects"
          >
            Browse projects <ArrowRight :size="14" />
          </RouterLink>
        </div>
        <p v-if="!workspaces.canManage" class="dashboard-onboarding-permission">
          A workspace owner or admin can create the first project or invite teammates.
        </p>
      </section>

      <section class="dashboard-focus" aria-labelledby="focus-title">
        <div class="dashboard-section-heading">
          <div>
            <p class="eyebrow">YOUR DAY</p>
            <h2 id="focus-title">My focus today</h2>
            <p>Assigned tasks across your workspaces.</p>
          </div>
          <RouterLink class="subtle-link" :to="{ name: 'my-tasks' }">
            View all my tasks <ArrowRight :size="14" />
          </RouterLink>
        </div>
        <p v-if="tasksError" class="dashboard-error" role="alert">{{ tasksError }}</p>
        <div v-else-if="taskFocus" class="focus-grid">
          <article class="focus-card">
            <span class="focus-card-icon"><Check :size="17" /></span>
            <span class="focus-card-label">Open tasks</span>
            <strong>{{ taskFocus.openCount }}</strong>
          </article>
          <article class="focus-card focus-card--today">
            <span class="focus-card-icon"><CalendarDays :size="17" /></span>
            <span class="focus-card-label">Due today</span>
            <strong>{{ taskFocus.dueTodayCount }}</strong>
          </article>
          <article class="focus-card focus-card--overdue">
            <span class="focus-card-icon"><X :size="17" /></span>
            <span class="focus-card-label">Overdue</span>
            <strong>{{ taskFocus.overdueCount }}</strong>
          </article>
        </div>
        <p
          v-if="!tasksError && taskFocus?.openCount === 0"
          class="dashboard-no-assigned"
          role="status"
        >
          No assigned tasks yet. When a task is assigned to you, your focus counts will appear here.
        </p>
      </section>

      <section class="overview-columns dashboard-columns">
        <article class="surface-panel upcoming-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">ACROSS YOUR WORKSPACES</p>
              <h2>Upcoming tasks</h2>
            </div>
            <RouterLink class="icon-button panel-action" :to="{ name: 'my-tasks' }" aria-label="View all my tasks">
              <ArrowUpRight :size="17" />
            </RouterLink>
          </div>
          <p v-if="tasksError" class="dashboard-error" role="alert">{{ tasksError }}</p>
          <div v-else-if="taskFocus?.upcomingTasks.length" class="dashboard-task-list">
            <RouterLink
              v-for="task in taskFocus.upcomingTasks"
              :key="task.id"
              class="dashboard-task-row"
              :to="{ name: 'project-detail', params: { projectId: task.projectId }, query: { task: task.id } }"
            >
              <span class="dashboard-task-copy">
                <strong>{{ task.title }}</strong>
                <span>{{ task.project.name }} · {{ task.workspace.name }}</span>
              </span>
              <span class="dashboard-task-meta">
                <span class="task-priority" :class="`task-priority--${task.priority.toLowerCase()}`">
                  {{ task.priority.toLowerCase() }}
                </span>
                <time :datetime="task.dueDate ?? undefined">{{ formatDueDate(task.dueDate) }}</time>
              </span>
            </RouterLink>
          </div>
          <div v-else-if="!tasksError" class="dashboard-empty">
            <span class="dashboard-empty-icon"><CalendarDays :size="18" /></span>
            <h3>No upcoming tasks</h3>
            <p>Tasks assigned to you with future or no due dates will show here.</p>
            <RouterLink class="subtle-link" :to="{ name: 'my-tasks' }">
              Open my tasks <ArrowRight :size="14" />
            </RouterLink>
          </div>
        </article>

        <article
          v-if="!isEmptyWorkspace"
          class="surface-panel projects-panel dashboard-projects-panel"
        >
          <div class="panel-heading">
            <div>
              <p class="eyebrow">{{ workspaces.active?.name ?? "YOUR WORKSPACE" }}</p>
              <h2>Your projects</h2>
            </div>
            <RouterLink class="icon-button panel-action" :to="{ name: 'projects' }" aria-label="View projects">
              <ArrowUpRight :size="17" />
            </RouterLink>
          </div>
          <p v-if="projectsError" class="dashboard-error" role="alert">{{ projectsError }}</p>
          <div v-else-if="recentProjects.length" class="dashboard-project-list">
            <RouterLink
              v-for="project in recentProjects"
              :key="project.id"
              class="dashboard-project-row"
              :to="{ name: 'project-detail', params: { projectId: project.id } }"
            >
              <span class="dashboard-project-icon"><FolderKanban :size="17" /></span>
              <span class="dashboard-project-copy">
                <strong>{{ project.name }}</strong>
                <span>{{ project.taskCount }} {{ project.taskCount === 1 ? "task" : "tasks" }}</span>
              </span>
              <span class="project-state" :class="`project-state--${project.state.toLowerCase()}`">
                {{ projectStates[project.state] }}
              </span>
            </RouterLink>
          </div>
          <div v-else-if="!projectsError" class="dashboard-empty dashboard-empty--compact">
            <span class="dashboard-empty-icon"><FolderPlus :size="18" /></span>
            <h3>No projects yet</h3>
            <p>Create a project to give your team's work a shared home.</p>
            <RouterLink
              v-if="workspaces.canManage"
              class="subtle-link"
              :to="{ name: 'projects', query: { create: 'true' } }"
            >
              Create a project <ArrowRight :size="14" />
            </RouterLink>
          </div>
        </article>
      </section>

      <section class="overview-columns dashboard-columns dashboard-lower-columns">
        <article class="surface-panel activity-panel dashboard-activity-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">{{ workspaces.active?.name ?? "YOUR WORKSPACE" }}</p>
              <h2>Recent activity</h2>
            </div>
            <span class="panel-heading-note">Persisted updates</span>
          </div>
          <p v-if="activityError" class="dashboard-error" role="alert">{{ activityError }}</p>
          <ul v-else-if="activities.length" class="dashboard-activity-list">
            <li v-for="activity in activities" :key="activity.id">
              <span class="activity-dot" aria-hidden="true"></span>
              <div class="dashboard-activity-copy">
                <p>
                  <strong>{{ activity.actorName ?? "A team member" }}</strong>
                  {{ actionLabel(activity.action) }}
                  <RouterLink :to="activityTarget(activity)">{{ activity.entityName }}</RouterLink>
                  <span v-if="activity.project"> in {{ activity.project.name }}</span>
                </p>
                <time :datetime="activity.createdAt">{{ formatTimestamp(activity.createdAt) }}</time>
              </div>
            </li>
          </ul>
          <div v-else-if="!activityError" class="dashboard-empty dashboard-empty--compact">
            <span class="dashboard-empty-icon"><Sparkles :size="18" /></span>
            <h3>No recent activity</h3>
            <p>Project and task updates will appear here as your workspace gets moving.</p>
          </div>
        </article>

        <article class="surface-panel invitation-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">FOR YOU</p>
              <h2>Pending invitations</h2>
            </div>
            <UsersRound :size="18" class="invitation-heading-icon" />
          </div>
          <p v-if="invitationError" class="dashboard-error" role="alert">{{ invitationError }}</p>
          <p v-if="invitationNotice" class="dashboard-success" role="status" aria-live="polite">
            <Check :size="15" /> {{ invitationNotice }}
          </p>
          <div v-if="invitations.length" class="dashboard-invitation-list">
            <article v-for="invitation in invitations" :key="invitation.id" class="dashboard-invitation">
              <div>
                <h3>{{ invitation.workspaceName }}</h3>
                <p>{{ invitation.inviterName }} invited you as {{ invitation.role.toLowerCase() }}.</p>
                <time :datetime="invitation.expiresAt">Expires {{ formatTimestamp(invitation.expiresAt) }}</time>
              </div>
              <div class="invitation-actions">
                <button
                  class="button button--quiet"
                  type="button"
                  :disabled="busyInvitationId === invitation.id"
                  :aria-label="`Decline invitation to ${invitation.workspaceName}`"
                  @click="respondToInvitation(invitation, 'decline')"
                >
                  Decline
                </button>
                <button
                  class="button button--primary"
                  type="button"
                  :disabled="busyInvitationId === invitation.id"
                  :aria-label="`Accept invitation to ${invitation.workspaceName}`"
                  @click="respondToInvitation(invitation, 'accept')"
                >
                  <LoaderCircle v-if="busyInvitationId === invitation.id" class="project-spinner" :size="14" />
                  <Check v-else :size="14" /> Accept
                </button>
              </div>
            </article>
          </div>
          <div v-else-if="!invitationError" class="dashboard-empty dashboard-empty--compact">
            <span class="dashboard-empty-icon"><UsersRound :size="18" /></span>
            <h3>No pending invitations</h3>
            <p>Workspace invitations sent to your verified email will show here.</p>
          </div>
        </article>
      </section>
    </template>
  </div>
</template>
