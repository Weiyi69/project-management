<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { AlertCircle, ArrowLeft, Download, LoaderCircle } from "@lucide/vue";
import type { AnalyticsProjectResponse } from "@orbit/contracts";
import AnalyticsBarChart from "../components/analytics/AnalyticsBarChart.vue";
import { analyticsApi } from "../lib/analytics-api";

const route = useRoute();
const report = ref<AnalyticsProjectResponse | null>(null);
const loading = ref(true);
const exporting = ref(false);
const error = ref("");
let latestLoad = 0;

const statusChart = computed(() =>
  (report.value?.statuses ?? []).map((status) => ({
    label: status.name,
    value: status.taskCount,
    color: status.color,
  })),
);
const workloadChart = computed(() =>
  (report.value?.workload ?? []).map((member) => ({
    label: member.name,
    value: member.assignedOpenTasks,
  })),
);
const dueDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const completionLabel = computed(() => {
  const rate = report.value?.project.health.completionRate;
  return rate === null || rate === undefined ? "—" : `${rate}%`;
});

function formatDueDate(value: string): string {
  return dueDateFormatter.format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

async function loadAnalytics(): Promise<void> {
  const loadId = ++latestLoad;
  loading.value = true;
  error.value = "";
  try {
    const result = await analyticsApi.getProject(String(route.params.projectId));
    if (loadId === latestLoad) report.value = result;
  } catch (caught) {
    if (loadId === latestLoad) {
      error.value = caught instanceof Error ? caught.message : "Could not load project analytics.";
    }
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
}

async function exportReport(): Promise<void> {
  if (!report.value) return;
  exporting.value = true;
  error.value = "";
  try {
    await analyticsApi.exportProject(report.value.project.id);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not export project analytics.";
  } finally {
    exporting.value = false;
  }
}

onMounted(loadAnalytics);
watch(() => route.params.projectId, () => void loadAnalytics());
</script>

<template>
  <section class="section-page analytics-page">
    <header class="analytics-heading">
      <div>
        <p class="eyebrow">{{ report?.workspace.name ?? "PROJECT ANALYTICS" }}</p>
        <h1>{{ report?.project.name ?? "Project analytics" }}</h1>
        <p class="page-subtitle">Health, workflow progress, upcoming work, and team workload.</p>
      </div>
      <div class="analytics-heading-actions">
        <RouterLink class="button button--secondary" :to="{ name: 'analytics' }">
          <ArrowLeft :size="15" /> All analytics
        </RouterLink>
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
      <LoaderCircle class="spin" :size="20" /> Loading project analytics…
    </div>

    <template v-else-if="report">
      <section class="analytics-detail-health">
        <div>
          <span
            class="analytics-health"
            :class="`analytics-health--${report.project.health.status.toLowerCase().replace('_', '-')}`"
          >
            {{ report.project.health.status.replace("_", " ") }}
          </span>
          <ul class="analytics-reasons">
            <li v-for="reason in report.project.health.reasons" :key="reason">{{ reason }}</li>
          </ul>
        </div>
        <div class="analytics-completion">
          <span>Completion</span>
          <strong>{{ completionLabel }}</strong>
          <small>{{ report.project.health.completedTasks }} of {{ report.project.health.taskCount }} tasks</small>
        </div>
      </section>

      <section class="analytics-metrics" aria-label="Project metrics">
        <article class="analytics-metric-card">
          <span class="analytics-metric-label">Total tasks</span>
          <strong>{{ report.project.health.taskCount }}</strong>
          <small>{{ report.project.health.completedTasks }} completed</small>
        </article>
        <article class="analytics-metric-card">
          <span class="analytics-metric-label">Overdue</span>
          <strong>{{ report.project.health.overdueTasks }}</strong>
          <small>Incomplete tasks past due</small>
        </article>
        <article class="analytics-metric-card">
          <span class="analytics-metric-label">Due within 7 days</span>
          <strong>{{ report.project.health.dueSoonTasks }}</strong>
          <small>Incomplete tasks due soon</small>
        </article>
        <article class="analytics-metric-card">
          <span class="analytics-metric-label">Unassigned</span>
          <strong>{{ report.project.health.unassignedTasks }}</strong>
          <small>Incomplete tasks without an owner</small>
        </article>
      </section>

      <section class="analytics-chart-grid analytics-chart-grid--two">
        <AnalyticsBarChart title="Tasks by workflow status" :items="statusChart" empty-message="No workflow statuses exist." />
        <AnalyticsBarChart title="Assigned incomplete tasks" :items="workloadChart" empty-message="No incomplete tasks are assigned." />
      </section>

      <section class="analytics-project-list">
        <div class="analytics-section-heading">
          <div>
            <p class="eyebrow">ACTIONABLE WORK</p>
            <h2>Overdue and upcoming tasks</h2>
          </div>
          <span>{{ report.dueTasks.length }} tasks</span>
        </div>
        <div v-if="report.dueTasks.length" class="analytics-due-table-wrap">
          <table class="analytics-due-table">
            <thead>
              <tr><th>Task</th><th>Due date</th><th>Status</th><th>Assignee</th></tr>
            </thead>
            <tbody>
              <tr v-for="task in report.dueTasks" :key="task.id">
                <td>{{ task.title }}</td>
                <td>{{ formatDueDate(task.dueDate) }}</td>
                <td>{{ task.statusName }}</td>
                <td>{{ task.assigneeName ?? "Unassigned" }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="report.dueTasksLimited" class="analytics-definition-note">
            Showing the first 100 overdue or upcoming tasks. Export the CSV for the report data.
          </p>
        </div>
        <div v-else class="analytics-empty">
          <p>No overdue or upcoming incomplete tasks.</p>
        </div>
      </section>

      <p class="analytics-definition-note">
        Health rules: overdue work is At risk; due-soon or unassigned work needs attention; otherwise the project is On track.
      </p>
    </template>
  </section>
</template>
