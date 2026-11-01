<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { AlertCircle, Download, FolderKanban, LoaderCircle, RefreshCw } from "@lucide/vue";
import type { AnalyticsWorkspaceResponse, ProjectHealthStatus } from "@orbit/contracts";
import AnalyticsBarChart from "../components/analytics/AnalyticsBarChart.vue";
import { analyticsApi } from "../lib/analytics-api";
import { useWorkspaceStore } from "../stores/workspaces";

const workspaces = useWorkspaceStore();
const report = ref<AnalyticsWorkspaceResponse | null>(null);
const loading = ref(true);
const exporting = ref(false);
const error = ref("");
let latestLoad = 0;
let lastWorkspaceId = workspaces.selectedId;

const healthLabels: Record<ProjectHealthStatus, string> = {
  ON_TRACK: "On track",
  NEEDS_ATTENTION: "Needs attention",
  AT_RISK: "At risk",
};

const healthChart = computed(() =>
  [
    { label: "On track", value: report.value?.projects.filter((p) => p.health.status === "ON_TRACK").length ?? 0, color: "#16a34a" },
    { label: "Needs attention", value: report.value?.projects.filter((p) => p.health.status === "NEEDS_ATTENTION").length ?? 0, color: "#d97706" },
    { label: "At risk", value: report.value?.projects.filter((p) => p.health.status === "AT_RISK").length ?? 0, color: "#dc2626" },
  ],
);

const projectChart = computed(() =>
  [...(report.value?.projects ?? [])]
    .sort((left, right) => right.health.taskCount - left.health.taskCount)
    .slice(0, 6)
    .map((project) => ({ label: project.name, value: project.health.taskCount })),
);

const workloadChart = computed(() =>
  (report.value?.workload ?? [])
    .slice(0, 8)
    .map((member) => ({ label: member.name, value: member.assignedOpenTasks })),
);

const completionLabel = computed(() => {
  const rate = report.value?.summary.completionRate;
  return rate === null || rate === undefined ? "—" : `${rate}%`;
});

async function loadAnalytics(): Promise<void> {
  const loadId = ++latestLoad;
  if (!workspaces.active) {
    report.value = null;
    loading.value = false;
    return;
  }

  loading.value = true;
  error.value = "";
  const workspaceId = workspaces.active.id;
  try {
    const result = await analyticsApi.getWorkspace(workspaceId);
    if (loadId === latestLoad) report.value = result;
  } catch (caught) {
    if (loadId === latestLoad) {
      error.value = caught instanceof Error ? caught.message : "Could not load workspace analytics.";
    }
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
}

async function exportReport(): Promise<void> {
  if (!workspaces.active) return;
  exporting.value = true;
  error.value = "";
  try {
    await analyticsApi.exportWorkspace(workspaces.active.id);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not export analytics.";
  } finally {
    exporting.value = false;
  }
}

onMounted(async () => {
  try {
    await workspaces.load();
  } catch {
    error.value = workspaces.error || "Could not load your workspace.";
    loading.value = false;
    return;
  }
  lastWorkspaceId = workspaces.selectedId;
  await loadAnalytics();
});

watch(
  () => workspaces.selectedId,
  (workspaceId) => {
    if (workspaces.initialized && workspaceId !== lastWorkspaceId) {
      lastWorkspaceId = workspaceId;
      void loadAnalytics();
    }
  },
);
</script>

<template>
  <section class="section-page analytics-page">
    <header class="analytics-heading">
      <div>
        <p class="eyebrow">{{ report?.workspace.name ?? workspaces.active?.name ?? "WORKSPACE" }}</p>
        <h1>Analytics</h1>
        <p class="page-subtitle">A current view of project health, progress, and team workload.</p>
      </div>
      <div class="analytics-heading-actions">
        <button class="button button--secondary" type="button" :disabled="loading" @click="loadAnalytics">
          <RefreshCw :size="15" /> Refresh
        </button>
        <button
          class="button button--primary"
          type="button"
          :disabled="!report || exporting"
          @click="exportReport"
        >
          <LoaderCircle v-if="exporting" class="spin" :size="15" />
          <Download v-else :size="15" />
          Export CSV
        </button>
      </div>
    </header>

    <p v-if="error" class="analytics-error" role="alert">
      <AlertCircle :size="16" /> {{ error }}
    </p>

    <div v-if="loading" class="analytics-loading" role="status">
      <LoaderCircle class="spin" :size="20" /> Loading workspace analytics…
    </div>

    <template v-else-if="report">
      <section class="analytics-metrics" aria-label="Workspace metrics">
        <article class="analytics-metric-card">
          <span class="analytics-metric-icon"><FolderKanban :size="17" /></span>
          <span class="analytics-metric-label">Projects</span>
          <strong>{{ report.summary.totalProjects }}</strong>
          <small>{{ report.summary.activeProjects }} active</small>
        </article>
        <article class="analytics-metric-card">
          <span class="analytics-metric-icon"><span class="analytics-dot analytics-dot--purple"></span></span>
          <span class="analytics-metric-label">Tasks</span>
          <strong>{{ report.summary.totalTasks }}</strong>
          <small>{{ report.summary.completedTasks }} completed</small>
        </article>
        <article class="analytics-metric-card">
          <span class="analytics-metric-icon"><span class="analytics-dot analytics-dot--green"></span></span>
          <span class="analytics-metric-label">Completion</span>
          <strong>{{ completionLabel }}</strong>
          <small>Across all workspace tasks</small>
        </article>
        <article class="analytics-metric-card">
          <span class="analytics-metric-icon"><AlertCircle :size="17" /></span>
          <span class="analytics-metric-label">Overdue &amp; due soon</span>
          <strong>{{ report.summary.overdueTasks + report.summary.dueSoonTasks }}</strong>
          <small>{{ report.unassignedOpenTasks }} unassigned open</small>
        </article>
      </section>

      <section class="analytics-chart-grid" aria-label="Workspace charts">
        <AnalyticsBarChart
          title="Project health"
          :items="healthChart"
          empty-message="Create a project to see health."
        />
        <AnalyticsBarChart
          title="Tasks by project"
          :items="projectChart"
          empty-message="Projects will appear here as they are created."
        />
        <AnalyticsBarChart
          title="Assigned open tasks"
          :items="workloadChart"
          empty-message="No incomplete tasks are currently assigned."
        />
      </section>

      <section class="analytics-project-list">
        <div class="analytics-section-heading">
          <div>
            <p class="eyebrow">PROJECT DRILL-DOWN</p>
            <h2>Project health</h2>
          </div>
          <span>{{ report.projects.length }} projects</span>
        </div>
        <div v-if="report.projects.length" class="analytics-project-rows">
          <RouterLink
            v-for="project in report.projects"
            :key="project.id"
            class="analytics-project-row"
            :to="{ name: 'analytics-project', params: { projectId: project.id } }"
          >
            <span class="analytics-project-name">{{ project.name }}</span>
            <span class="analytics-health" :class="`analytics-health--${project.health.status.toLowerCase().replace('_', '-')}`">
              {{ healthLabels[project.health.status] }}
            </span>
            <span>{{ project.health.taskCount }} tasks</span>
            <span>{{ project.health.completionRate === null ? "—" : `${project.health.completionRate}%` }}</span>
            <span class="analytics-project-reason">{{ project.health.reasons[0] }}</span>
          </RouterLink>
        </div>
        <div v-else class="analytics-empty">
          <FolderKanban :size="20" />
          <p>No projects in this workspace yet.</p>
          <RouterLink class="subtle-link" :to="{ name: 'projects' }">Create a project</RouterLink>
        </div>
      </section>

      <p class="analytics-definition-note">
        Health is calculated from incomplete overdue, due-soon, and unassigned tasks.
        <span v-if="report.generatedAt"> Data refreshed {{ new Date(report.generatedAt).toLocaleString() }}.</span>
      </p>
    </template>
  </section>
</template>
