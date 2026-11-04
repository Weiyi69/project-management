<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
} from "@lucide/vue";
import type { TaskPriority, WorkspaceCalendarTask } from "@orbit/contracts";
import WorkspaceCalendarTaskCard from "../components/calendar/WorkspaceCalendarTask.vue";
import { taskApi } from "../lib/task-api";
import { useWorkspaceStore } from "../stores/workspaces";

type CalendarView = "month" | "week" | "day" | "agenda";
interface CalendarDay {
  key: string;
  date: Date;
  inFocusedMonth: boolean;
  tasks: WorkspaceCalendarTask[];
}

const router = useRouter();
const workspaces = useWorkspaceStore();
const calendar = ref<Awaited<ReturnType<typeof taskApi.workspaceCalendar>> | null>(null);
const focusedDate = ref(dateKey(new Date()));
const view = ref<CalendarView>("month");
const projectFilter = ref("");
const statusFilter = ref("");
const priorityFilter = ref<TaskPriority | "">("");
const assigneeFilter = ref("");
const loading = ref(true);
const error = ref("");
const loadedWorkspaceId = ref("");
let latestRequest = 0;

const viewOptions: Array<{ value: CalendarView; label: string }> = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "agenda", label: "Agenda" },
];

const priorityOptions: Array<{ value: TaskPriority; label: string }> = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

const focused = computed(() => parseDateKey(focusedDate.value));
const period = computed(() => {
  const date = focused.value;
  if (view.value === "month") {
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    const start = addDays(first, -first.getDay());
    return { start: dateKey(start), end: dateKey(addDays(start, 41)) };
  }
  if (view.value === "week") {
    const start = addDays(date, -date.getDay());
    return { start: dateKey(start), end: dateKey(addDays(start, 6)) };
  }
  if (view.value === "day") {
    return { start: dateKey(date), end: dateKey(date) };
  }
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: dateKey(start), end: dateKey(end) };
});

const heading = computed(() => {
  const start = parseDateKey(period.value.start);
  const end = parseDateKey(period.value.end);
  if (view.value === "month" || view.value === "agenda") {
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(focused.value);
  }
  if (view.value === "day") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(focused.value);
  }

  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const firstFormat = new Intl.DateTimeFormat(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
  });
  const endFormat = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${firstFormat.format(start)} – ${endFormat.format(end)}`;
});

const statusOptions = computed(() =>
  (calendar.value?.projects ?? []).flatMap((project) =>
    project.statuses.map((status) => ({
      id: status.id,
      label: `${project.name} · ${status.name}`,
    })),
  ),
);

const filteredTasks = computed(() =>
  (calendar.value?.tasks ?? []).filter((task) => {
    if (projectFilter.value && task.projectId !== projectFilter.value) return false;
    if (statusFilter.value && task.statusId !== statusFilter.value) return false;
    if (priorityFilter.value && task.priority !== priorityFilter.value) return false;
    if (assigneeFilter.value === "__unassigned__" && task.assignee) return false;
    if (
      assigneeFilter.value &&
      assigneeFilter.value !== "__unassigned__" &&
      task.assignee?.id !== assigneeFilter.value
    ) {
      return false;
    }
    return true;
  }),
);

const tasksByDate = computed(() => {
  const grouped = new Map<string, WorkspaceCalendarTask[]>();
  for (const task of filteredTasks.value) {
    const dated = grouped.get(task.dueDate) ?? [];
    dated.push(task);
    grouped.set(task.dueDate, dated);
  }
  return grouped;
});

const calendarDays = computed<CalendarDay[]>(() => {
  const date = focused.value;
  let start: Date;
  let count: number;
  if (view.value === "month") {
    const first = new Date(date.getFullYear(), date.getMonth(), 1);
    start = addDays(first, -first.getDay());
    count = 42;
  } else if (view.value === "week") {
    start = addDays(date, -date.getDay());
    count = 7;
  } else if (view.value === "day") {
    start = date;
    count = 1;
  } else {
    start = new Date(date.getFullYear(), date.getMonth(), 1);
    count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  }

  return Array.from({ length: count }, (_unused, index) => {
    const current = addDays(start, index);
    const key = dateKey(current);
    return {
      key,
      date: current,
      inFocusedMonth: current.getMonth() === date.getMonth(),
      tasks: tasksByDate.value.get(key) ?? [],
    };
  });
});

const agendaDays = computed(() => calendarDays.value.filter((day) => day.tasks.length > 0));
const hasFilters = computed(
  () => Boolean(projectFilter.value || statusFilter.value || priorityFilter.value || assigneeFilter.value),
);
const createProjectId = computed(
  () => projectFilter.value || calendar.value?.projects[0]?.id || "",
);
const emptyMessage = computed(() =>
  hasFilters.value
    ? "No tasks match these filters in this period."
    : "No tasks with due dates fall in this period.",
);

function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(date);
}

function navigatePeriod(amount: number): void {
  const date = focused.value;
  if (view.value === "month" || view.value === "agenda") {
    focusedDate.value = dateKey(new Date(date.getFullYear(), date.getMonth() + amount, 1));
  } else if (view.value === "week") {
    focusedDate.value = dateKey(addDays(date, amount * 7));
  } else {
    focusedDate.value = dateKey(addDays(date, amount));
  }
}

function resetFilters(): void {
  projectFilter.value = "";
  statusFilter.value = "";
  priorityFilter.value = "";
  assigneeFilter.value = "";
}

async function loadCalendar(): Promise<void> {
  const requestId = ++latestRequest;
  const workspaceId = workspaces.selectedId;
  if (!workspaceId) {
    calendar.value = null;
    loadedWorkspaceId.value = "";
    loading.value = false;
    error.value = "Select a workspace to view its calendar.";
    return;
  }

  if (loadedWorkspaceId.value !== workspaceId) {
    calendar.value = null;
    resetFilters();
  }
  loading.value = true;
  error.value = "";
  try {
    const result = await taskApi.workspaceCalendar(
      workspaceId,
      period.value.start,
      period.value.end,
    );
    if (requestId === latestRequest) {
      calendar.value = result;
      loadedWorkspaceId.value = workspaceId;
    }
  } catch (caught) {
    if (requestId === latestRequest) {
      error.value = caught instanceof Error ? caught.message : "Could not load the workspace calendar.";
    }
  } finally {
    if (requestId === latestRequest) loading.value = false;
  }
}

async function openTask(task: WorkspaceCalendarTask): Promise<void> {
  await router.push({
    name: "project-detail",
    params: { projectId: task.projectId },
    query: { task: task.id },
  });
}

async function createTask(): Promise<void> {
  if (!createProjectId.value) return;
  await router.push({
    name: "project-detail",
    params: { projectId: createProjectId.value },
    query: { createTask: "1" },
  });
}

onMounted(() => {
  if (!workspaces.initialized) {
    void workspaces.load().catch((caught: unknown) => {
      error.value = caught instanceof Error ? caught.message : "Could not load your workspaces.";
      loading.value = false;
    });
  }
});

watch(
  () => [workspaces.initialized, workspaces.selectedId, period.value.start, period.value.end] as const,
  ([initialized, workspaceId]) => {
    if (initialized && workspaceId) void loadCalendar();
    else if (initialized) {
      calendar.value = null;
      loadedWorkspaceId.value = "";
      loading.value = false;
      error.value = "Select a workspace to view its calendar.";
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="section-page workspace-calendar-page">
    <header class="workspace-calendar-heading">
      <div>
        <p class="eyebrow">{{ workspaces.active?.name ?? "YOUR WORKSPACE" }}</p>
        <h1>Calendar</h1>
        <p class="page-subtitle">Due dates across your workspace projects.</p>
      </div>
      <button
        class="button button--primary"
        type="button"
        :disabled="!createProjectId"
        :title="createProjectId ? 'Create a task in the selected or first project' : 'Create a project before adding tasks'"
        @click="createTask"
      >
        <Plus :size="16" /> Create task
      </button>
    </header>

    <section class="workspace-calendar-toolbar" aria-label="Calendar controls">
      <div class="workspace-calendar-period">
        <div class="workspace-calendar-period-actions">
          <button class="icon-button" type="button" aria-label="Previous period" @click="navigatePeriod(-1)">
            <ChevronLeft :size="17" />
          </button>
          <button class="icon-button" type="button" aria-label="Next period" @click="navigatePeriod(1)">
            <ChevronRight :size="17" />
          </button>
          <button class="button button--quiet workspace-calendar-today" type="button" @click="focusedDate = dateKey(new Date())">
            <CalendarDays :size="14" /> Today
          </button>
        </div>
        <h2 aria-live="polite">{{ heading }}</h2>
      </div>
      <div class="workspace-calendar-view-switch" role="group" aria-label="Calendar view">
        <button
          v-for="option in viewOptions"
          :key="option.value"
          type="button"
          :aria-pressed="view === option.value"
          :class="{ 'is-active': view === option.value }"
          @click="view = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </section>

    <section class="workspace-calendar-filters" aria-label="Calendar filters">
      <label>
        <span>Project</span>
        <select v-model="projectFilter" aria-label="Filter by project">
          <option value="">All projects</option>
          <option v-for="project in calendar?.projects ?? []" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </label>
      <label>
        <span>Status</span>
        <select v-model="statusFilter" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option v-for="status in statusOptions" :key="status.id" :value="status.id">
            {{ status.label }}
          </option>
        </select>
      </label>
      <label>
        <span>Priority</span>
        <select v-model="priorityFilter" aria-label="Filter by priority">
          <option value="">All priorities</option>
          <option v-for="priority in priorityOptions" :key="priority.value" :value="priority.value">
            {{ priority.label }}
          </option>
        </select>
      </label>
      <label>
        <span>Assignee</span>
        <select v-model="assigneeFilter" aria-label="Filter by assignee">
          <option value="">All assignees</option>
          <option value="__unassigned__">Unassigned</option>
          <option v-for="member in calendar?.members ?? []" :key="member.id" :value="member.id">
            {{ member.name }}
          </option>
        </select>
      </label>
      <button
        class="button button--quiet workspace-calendar-clear"
        type="button"
        :disabled="!hasFilters"
        @click="resetFilters"
      >
        <RotateCcw :size="14" /> Clear filters
      </button>
    </section>

    <p v-if="error" class="project-error workspace-calendar-error" role="alert">
      {{ error }}
      <button class="button button--quiet" type="button" @click="loadCalendar">
        <RefreshCw :size="14" /> Try again
      </button>
    </p>
    <div v-if="loading" class="project-loading" role="status">
      <LoaderCircle class="project-spinner" :size="20" /> Loading workspace calendar…
    </div>

    <template v-else-if="calendar && !error">
      <p class="sr-only" aria-live="polite">
        {{ filteredTasks.length }} {{ filteredTasks.length === 1 ? "task" : "tasks" }} in this period.
      </p>
      <div v-if="!filteredTasks.length" class="workspace-calendar-empty" role="status">
        <span class="workspace-calendar-empty-icon"><CalendarDays :size="20" /></span>
        <h2>No tasks to show</h2>
        <p>{{ emptyMessage }}</p>
        <button v-if="hasFilters" class="button button--quiet" type="button" @click="resetFilters">
          Clear filters
        </button>
      </div>

      <template v-else-if="view === 'month'">
        <div class="workspace-calendar-month-weekdays" aria-hidden="true">
          <span v-for="day in ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']" :key="day">
            {{ day }}
          </span>
        </div>
        <div class="workspace-calendar-month-grid" :aria-label="`${heading} month view`">
          <section
            v-for="day in calendarDays"
            :key="day.key"
            class="workspace-calendar-month-cell"
            :class="{
              'is-outside-month': !day.inFocusedMonth,
              'is-today': day.key === dateKey(new Date()),
            }"
            :aria-label="`${formatDay(day.date)}, ${day.tasks.length} ${day.tasks.length === 1 ? 'task' : 'tasks'}`"
          >
            <h3 class="workspace-calendar-date">
              <span>{{ day.date.getDate() }}</span>
              <span v-if="day.key === dateKey(new Date())" class="workspace-calendar-today-label">Today</span>
            </h3>
            <WorkspaceCalendarTaskCard
              v-for="task in day.tasks"
              :key="task.id"
              :task="task"
              @open="openTask"
            />
          </section>
        </div>
      </template>

      <template v-else-if="view === 'week'">
        <div class="workspace-calendar-week-grid" :aria-label="`${heading} week view`">
          <section
            v-for="day in calendarDays"
            :key="day.key"
            class="workspace-calendar-week-day"
            :class="{ 'is-today': day.key === dateKey(new Date()) }"
            :aria-label="`${formatDay(day.date)}, ${day.tasks.length} ${day.tasks.length === 1 ? 'task' : 'tasks'}`"
          >
            <h3 class="workspace-calendar-date workspace-calendar-date--week">
              <span>{{ formatDay(day.date) }}</span>
              <span v-if="day.key === dateKey(new Date())" class="workspace-calendar-today-label">Today</span>
            </h3>
            <WorkspaceCalendarTaskCard
              v-for="task in day.tasks"
              :key="task.id"
              :task="task"
              @open="openTask"
            />
            <p v-if="!day.tasks.length" class="workspace-calendar-no-day-tasks">No tasks</p>
          </section>
        </div>
      </template>

      <template v-else-if="view === 'day'">
        <section class="workspace-calendar-single-day" :aria-label="`${heading} day view`">
          <h3 class="workspace-calendar-date workspace-calendar-date--week">
            <span>{{ formatDay(calendarDays[0]!.date) }}</span>
          </h3>
          <WorkspaceCalendarTaskCard
            v-for="task in calendarDays[0]!.tasks"
            :key="task.id"
            :task="task"
            @open="openTask"
          />
        </section>
      </template>

      <template v-else>
        <div class="workspace-calendar-agenda" role="region" aria-label="Agenda view">
          <section v-for="day in agendaDays" :key="day.key" class="workspace-calendar-agenda-day">
            <h3>{{ formatDay(day.date) }}</h3>
            <WorkspaceCalendarTaskCard
              v-for="task in day.tasks"
              :key="task.id"
              :task="task"
              @open="openTask"
            />
          </section>
          <p v-if="!agendaDays.length" class="workspace-calendar-no-day-tasks">
            No tasks with due dates this month.
          </p>
        </div>
      </template>
    </template>
  </section>
</template>
