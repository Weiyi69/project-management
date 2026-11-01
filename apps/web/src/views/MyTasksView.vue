<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { CalendarDays, LoaderCircle, RefreshCw } from "@lucide/vue";
import type { MyTaskSummary } from "@orbit/contracts";
import { taskApi } from "../lib/task-api";

const tasks = ref<MyTaskSummary[]>([]);
const loading = ref(true);
const error = ref("");
const includeCompleted = ref(false);
let latestRequest = 0;

const priorityLabels: Record<MyTaskSummary["priority"], string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

async function loadTasks(): Promise<void> {
  const requestId = ++latestRequest;
  loading.value = true;
  error.value = "";
  try {
    const response = await taskApi.listMyTasks(includeCompleted.value);
    if (requestId !== latestRequest) return;
    tasks.value = response.tasks;
  } catch (caught) {
    if (requestId !== latestRequest) return;
    tasks.value = [];
    error.value = caught instanceof Error ? caught.message : "Could not load your tasks.";
  } finally {
    if (requestId === latestRequest) loading.value = false;
  }
}

function formatDueDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

onMounted(loadTasks);
watch(includeCompleted, () => void loadTasks());
</script>

<template>
  <section class="section-page my-tasks-page">
    <header class="my-tasks-heading">
      <div>
        <p class="eyebrow">PERSONAL WORK</p>
        <h1>My tasks</h1>
        <p class="page-subtitle">Your assigned work, gathered from every workspace you can access.</p>
      </div>
      <label class="my-tasks-completed-toggle">
        <input v-model="includeCompleted" type="checkbox" />
        <span>Include completed</span>
      </label>
    </header>

    <p v-if="error" class="project-error my-tasks-error" role="alert">
      {{ error }}
      <button class="button button--quiet" type="button" @click="loadTasks">
        <RefreshCw :size="14" /> Try again
      </button>
    </p>

    <div v-if="loading" class="project-loading" role="status">
      <LoaderCircle class="project-spinner" :size="20" /> Loading your tasks…
    </div>

    <div v-else-if="tasks.length" class="task-table-wrap">
      <table class="task-table my-tasks-table" aria-label="Tasks assigned to you">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Project</th>
            <th scope="col">Workspace</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Due date</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in tasks" :key="task.id">
            <td>
              <RouterLink
                class="task-table-title"
                :to="{
                  name: 'project-detail',
                  params: { projectId: task.projectId },
                  query: { task: task.id },
                }"
              >
                {{ task.title }}
              </RouterLink>
            </td>
            <td>{{ task.project.name }}</td>
            <td>{{ task.project.workspace.name }}</td>
            <td>
              <span class="my-task-status">
                <span class="project-status-dot" :style="{ backgroundColor: task.statusColor }"></span>
                {{ task.statusName }}
              </span>
            </td>
            <td>
              <span
                class="task-priority"
                :class="`task-priority--${task.priority.toLowerCase()}`"
              >
                {{ priorityLabels[task.priority] }}
              </span>
            </td>
            <td>
              <span v-if="task.dueDate" class="my-task-due-date">
                <CalendarDays :size="14" /> {{ formatDueDate(task.dueDate) }}
              </span>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="!error" class="my-tasks-empty">
      <p class="eyebrow">{{ includeCompleted ? "ALL CAUGHT UP" : "NO OPEN TASKS" }}</p>
      <h2>{{ includeCompleted ? "No assigned tasks yet." : "Nothing on your plate." }}</h2>
      <p>
        {{ includeCompleted
          ? "Tasks assigned to you will appear here."
          : "Completed tasks are hidden. Turn them on above, or browse projects for more work." }}
      </p>
      <RouterLink class="button button--quiet" :to="{ name: 'projects' }">Browse projects</RouterLink>
    </div>
  </section>
</template>
