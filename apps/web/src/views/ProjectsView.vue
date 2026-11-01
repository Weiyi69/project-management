<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import {
  ArrowRight,
  FolderKanban,
  FolderPlus,
  LoaderCircle,
  Plus,
  Sparkles,
} from "@lucide/vue";
import type { ProjectSummary } from "@orbit/contracts";
import { projectApi } from "../lib/project-api";
import { useWorkspaceStore } from "../stores/workspaces";

const router = useRouter();
const route = useRoute();
const workspaces = useWorkspaceStore();
const projects = ref<ProjectSummary[]>([]);
const loading = ref(true);
const submitting = ref(false);
const createOpen = ref(false);
const projectName = ref("");
const projectDescription = ref("");
const error = ref("");

const stateLabels: Record<ProjectSummary["state"], string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

async function loadProjects(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    await workspaces.load();
    const projectResponse = await projectApi.list();
    projects.value = projectResponse.projects;
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : "Could not load projects. Please try again.";
  } finally {
    loading.value = false;
  }
}

async function createProject(): Promise<void> {
  submitting.value = true;
  error.value = "";
  try {
    const { project } = await projectApi.create({
      name: projectName.value,
      description: projectDescription.value,
    });
    if (route.query.onboarding === "1") {
      await router.push({ name: "overview" });
      return;
    }
    await router.push({
      name: "project-detail",
      params: { projectId: project.id },
      ...(route.query.createTask === "1" ? { query: { createTask: "1" } } : {}),
    });
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : "Could not create the project. Please try again.";
  } finally {
    submitting.value = false;
  }
}

onMounted(loadProjects);
watch(
  () => workspaces.selectedId,
  () => {
    if (workspaces.initialized) void loadProjects();
  },
);
watch(
  () => [route.query.create, workspaces.canManage] as const,
  ([requested]) => {
    if (requested === "true" && workspaces.canManage) {
      createOpen.value = true;
      void router.replace({ query: { ...route.query, create: undefined } });
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="section-page projects-page">
    <header class="projects-heading">
      <div>
        <p class="eyebrow">{{ workspaces.active?.name ?? "YOUR WORKSPACE" }}</p>
        <h1>Projects</h1>
        <p class="page-subtitle">A shared home for the work your team is moving forward.</p>
      </div>
      <button
        v-if="workspaces.canManage"
        class="button button--primary"
        type="button"
        @click="createOpen = !createOpen"
      >
        <Plus :size="16" /> New project
      </button>
    </header>

    <form v-if="createOpen" class="project-create-panel" @submit.prevent="createProject">
      <div class="project-create-heading">
        <span class="project-create-icon"><FolderPlus :size="18" /></span>
        <div>
          <h2>Start a project</h2>
          <p>It will be added to {{ workspaces.active?.name ?? "your workspace" }}.</p>
        </div>
      </div>
      <label class="project-field">
        <span>Project name</span>
        <input
          v-model="projectName"
          name="projectName"
          type="text"
          placeholder="e.g. Website refresh"
          minlength="2"
          maxlength="100"
          required
        />
      </label>
      <label class="project-field">
        <span>Description <span class="project-field-optional">Optional</span></span>
        <textarea
          v-model="projectDescription"
          name="projectDescription"
          placeholder="What are you working toward?"
          maxlength="2000"
          rows="3"
        ></textarea>
      </label>
      <p v-if="error" class="project-error" role="alert">{{ error }}</p>
      <div class="project-form-actions">
        <button class="button button--quiet" type="button" @click="createOpen = false">
          Cancel
        </button>
        <button class="button button--primary" type="submit" :disabled="submitting">
          <LoaderCircle v-if="submitting" class="project-spinner" :size="15" />
          {{ submitting ? "Creating..." : "Create project" }}
          <ArrowRight v-if="!submitting" :size="15" />
        </button>
      </div>
    </form>

    <p v-if="error && !createOpen" class="project-error" role="alert">{{ error }}</p>

    <div v-if="loading" class="project-loading" role="status">
      <LoaderCircle class="project-spinner" :size="20" /> Loading your projects…
    </div>
    <div v-else-if="projects.length" class="project-grid">
      <RouterLink
        v-for="project in projects"
        :key="project.id"
        class="project-card"
        :to="{ name: 'project-detail', params: { projectId: project.id } }"
      >
        <div class="project-card-top">
          <span class="project-card-icon"><FolderKanban :size="19" /></span>
          <span class="project-state" :class="`project-state--${project.state.toLowerCase()}`">
            {{ stateLabels[project.state] }}
          </span>
        </div>
        <h2>{{ project.name }}</h2>
        <p class="project-card-description">
          {{ project.description || "A new space for your team's work." }}
        </p>
        <div class="project-card-bottom">
          <span>{{ project.taskCount }} {{ project.taskCount === 1 ? "task" : "tasks" }}</span>
          <span>{{ project.statuses.length }} workflow statuses</span>
          <ArrowRight v-if="project.canManage" :size="15" />
        </div>
      </RouterLink>
      <button
        v-if="workspaces.canManage"
        class="project-card project-card--add"
        type="button"
        @click="createOpen = true"
      >
        <span class="project-add-icon"><Plus :size="18" /></span>
        <strong>Create another project</strong>
        <span>Give your next idea a place to grow.</span>
      </button>
    </div>
    <div v-else-if="!error" class="project-empty-state">
      <span class="project-empty-icon"><Sparkles :size="20" /></span>
      <p class="eyebrow">A FRESH START</p>
      <h2>Your first project starts here.</h2>
      <p>Give your team a shared place to plan and move work forward.</p>
      <button
        v-if="workspaces.canManage"
        class="button button--primary"
        type="button"
        @click="createOpen = true"
      >
        <FolderPlus :size="16" /> Create your first project
      </button>
      <p v-else class="workspace-permission-note">Ask a workspace admin to create your first project.</p>
    </div>
  </section>
</template>
