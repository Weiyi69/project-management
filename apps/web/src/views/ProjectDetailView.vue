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
import type { ProjectLifecycle, ProjectSummary } from "@orbit/contracts";
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

const projectId = computed(() => String(route.params.projectId));
const stateLabels: Record<ProjectLifecycle, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

async function loadProject(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const response = await projectApi.get(projectId.value);
    project.value = response.project;
    name.value = response.project.name;
    description.value = response.project.description ?? "";
    state.value = response.project.state;
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : "Could not load this project. Please try again.";
  } finally {
    loading.value = false;
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
