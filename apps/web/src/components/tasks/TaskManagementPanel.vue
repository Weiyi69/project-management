<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Columns3,
  List,
  LoaderCircle,
  MessageSquare,
  Plus,
  Tag,
  Trash2,
  X,
} from "@lucide/vue";
import type {
  ProjectLabelSummary,
  ProjectSummary,
  PresenceUser,
  RealtimeTaskEvent,
  TaskCommentSummary,
  TaskDetail,
  TaskPriority,
  TaskSummary,
  TaskWorkspaceMember,
} from "@orbit/contracts";
import { taskApi } from "../../lib/task-api";
import { getRealtimeSocket, joinProjectRoom } from "../../lib/realtime";

const props = defineProps<{ project: ProjectSummary }>();

type ViewMode = "kanban" | "table" | "calendar";
interface TaskDraft {
  title: string;
  description: string;
  statusId: string;
  priority: TaskPriority;
  assigneeId: string;
  startDate: string;
  dueDate: string;
  labelIds: string[];
}

const tasks = ref<TaskSummary[]>([]);
const members = ref<TaskWorkspaceMember[]>([]);
const labels = ref<ProjectLabelSummary[]>([]);
const presenceUsers = ref<PresenceUser[]>([]);
const statuses = computed(() => props.project.statuses);
const mode = ref<ViewMode>("kanban");
const loading = ref(true);
const submitting = ref(false);
const error = ref("");
const realtimeError = ref("");
const taskDialogOpen = ref(false);
const taskDetail = ref<TaskDetail | null>(null);
const draft = ref<TaskDraft>(emptyDraft());
const commentDraft = ref("");
const dependencyId = ref("");
const labelName = ref("");
const labelColor = ref("#6259D9");
const labelDialogOpen = ref(false);
const editingLabelId = ref("");
const editingLabelName = ref("");
const editingLabelColor = ref("");
const calendarDate = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const realtime = getRealtimeSocket();
let leaveProjectRoom: (() => void) | undefined;

const priorityLabels: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

function emptyDraft(statusId = statuses.value[0]?.id ?? ""): TaskDraft {
  return {
    title: "",
    description: "",
    statusId,
    priority: "MEDIUM",
    assigneeId: "",
    startDate: "",
    dueDate: "",
    labelIds: [],
  };
}

function setDraft(task?: TaskSummary): void {
  draft.value = task
    ? {
        title: task.title,
        description: task.description ?? "",
        statusId: task.statusId,
        priority: task.priority,
        assigneeId: task.assignee?.id ?? "",
        startDate: task.startDate ?? "",
        dueDate: task.dueDate ?? "",
        labelIds: task.labels.map((label) => label.id),
      }
    : emptyDraft();
}

async function loadTasks(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const response = await taskApi.list(props.project.id);
    tasks.value = response.tasks;
    members.value = response.members;
    labels.value = response.labels;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load project tasks.";
  } finally {
    loading.value = false;
  }
}

async function reloadDetail(taskId: string): Promise<void> {
  taskDetail.value = await taskApi.get(taskId);
  upsertTask(taskDetail.value);
}

function upsertTask(task: TaskSummary): void {
  const index = tasks.value.findIndex(({ id }) => id === task.id);
  if (index < 0) tasks.value.push(task);
  else tasks.value[index] = task;
}

function openCreate(): void {
  error.value = "";
  taskDetail.value = null;
  setDraft();
  taskDialogOpen.value = true;
}

async function openTask(task: TaskSummary): Promise<void> {
  error.value = "";
  submitting.value = true;
  try {
    taskDetail.value = await taskApi.get(task.id);
    setDraft(taskDetail.value);
    commentDraft.value = "";
    dependencyId.value = "";
    taskDialogOpen.value = true;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not open this task.";
  } finally {
    submitting.value = false;
  }
}

async function saveTask(): Promise<void> {
  submitting.value = true;
  error.value = "";
  const input = {
    title: draft.value.title,
    description: draft.value.description,
    statusId: draft.value.statusId,
    priority: draft.value.priority,
    assigneeId: draft.value.assigneeId || null,
    startDate: draft.value.startDate || null,
    dueDate: draft.value.dueDate || null,
    labelIds: draft.value.labelIds,
  };
  try {
    const task = taskDetail.value
      ? await taskApi.update(taskDetail.value.id, input)
      : await taskApi.create(props.project.id, input);
    taskDetail.value = task;
    upsertTask(task);
    taskDialogOpen.value = false;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not save this task.";
  } finally {
    submitting.value = false;
  }
}

async function moveTask(task: TaskSummary, statusId: string): Promise<void> {
  if (task.statusId === statusId) return;
  error.value = "";
  try {
    const updated = await taskApi.update(task.id, { statusId });
    upsertTask(updated);
    if (taskDetail.value?.id === task.id) taskDetail.value = updated;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not move this task.";
  }
}

async function deleteTask(): Promise<void> {
  if (!taskDetail.value) return;
  if (!window.confirm(`Permanently delete "${taskDetail.value.title}"?`)) return;
  submitting.value = true;
  error.value = "";
  try {
    await taskApi.remove(taskDetail.value.id);
    tasks.value = tasks.value.filter(({ id }) => id !== taskDetail.value?.id);
    taskDialogOpen.value = false;
    taskDetail.value = null;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not delete this task.";
  } finally {
    submitting.value = false;
  }
}

async function addComment(): Promise<void> {
  if (!taskDetail.value || !commentDraft.value.trim()) return;
  submitting.value = true;
  error.value = "";
  try {
    await taskApi.addComment(taskDetail.value.id, commentDraft.value);
    commentDraft.value = "";
    await reloadDetail(taskDetail.value.id);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not add comment.";
  } finally {
    submitting.value = false;
  }
}

async function editComment(comment: TaskCommentSummary): Promise<void> {
  const body = window.prompt("Edit comment", comment.body);
  if (body === null || !body.trim()) return;
  submitting.value = true;
  error.value = "";
  try {
    await taskApi.updateComment(comment.id, body);
    await reloadDetail(taskDetail.value!.id);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not update comment.";
  } finally {
    submitting.value = false;
  }
}

async function deleteComment(comment: TaskCommentSummary): Promise<void> {
  if (!window.confirm("Delete this comment?")) return;
  submitting.value = true;
  error.value = "";
  try {
    await taskApi.removeComment(comment.id);
    await reloadDetail(taskDetail.value!.id);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not delete comment.";
  } finally {
    submitting.value = false;
  }
}

async function addDependency(): Promise<void> {
  if (!taskDetail.value || !dependencyId.value) return;
  submitting.value = true;
  error.value = "";
  try {
    taskDetail.value = await taskApi.addDependency(taskDetail.value.id, dependencyId.value);
    upsertTask(taskDetail.value);
    dependencyId.value = "";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not add dependency.";
  } finally {
    submitting.value = false;
  }
}

async function removeDependency(dependsOnTaskId: string): Promise<void> {
  if (!taskDetail.value) return;
  submitting.value = true;
  error.value = "";
  try {
    taskDetail.value = await taskApi.removeDependency(taskDetail.value.id, dependsOnTaskId);
    upsertTask(taskDetail.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not remove dependency.";
  } finally {
    submitting.value = false;
  }
}

async function createLabel(): Promise<void> {
  if (!labelName.value.trim()) return;
  submitting.value = true;
  error.value = "";
  try {
    labels.value.push(
      await taskApi.createLabel(props.project.id, {
        name: labelName.value,
        color: labelColor.value,
      }),
    );
    labels.value.sort((a, b) => a.name.localeCompare(b.name));
    labelName.value = "";
    labelColor.value = "#6259D9";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not create label.";
  } finally {
    submitting.value = false;
  }
}

function startEditLabel(label: ProjectLabelSummary): void {
  editingLabelId.value = label.id;
  editingLabelName.value = label.name;
  editingLabelColor.value = label.color;
}

async function saveLabel(label: ProjectLabelSummary): Promise<void> {
  submitting.value = true;
  error.value = "";
  try {
    const updated = await taskApi.updateLabel(props.project.id, label.id, {
      name: editingLabelName.value,
      color: editingLabelColor.value,
    });
    labels.value = labels.value.map((item) => (item.id === updated.id ? updated : item));
    editingLabelId.value = "";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not update label.";
  } finally {
    submitting.value = false;
  }
}

async function deleteLabel(label: ProjectLabelSummary): Promise<void> {
  if (!window.confirm(`Delete the "${label.name}" label from this project?`)) return;
  submitting.value = true;
  error.value = "";
  try {
    await taskApi.removeLabel(props.project.id, label.id);
    labels.value = labels.value.filter(({ id }) => id !== label.id);
    tasks.value = tasks.value.map((task) => ({
      ...task,
      labels: task.labels.filter((item) => item.id !== label.id),
    }));
    if (taskDetail.value) {
      taskDetail.value = {
        ...taskDetail.value,
        labels: taskDetail.value.labels.filter((item) => item.id !== label.id),
      };
      setDraft(taskDetail.value);
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not delete label.";
  } finally {
    submitting.value = false;
  }
}

const sortedTasks = computed(() =>
  [...tasks.value].sort(
    (a, b) =>
      a.statusName.localeCompare(b.statusName) ||
      a.position - b.position ||
      a.title.localeCompare(b.title),
  ),
);

const calendarMonthLabel = computed(() =>
  calendarDate.value.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
);
const calendarCells = computed(() => {
  const first = new Date(calendarDate.value.getFullYear(), calendarDate.value.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    const date = formatDate(day);
    return {
      date,
      day: day.getDate(),
      inMonth: day.getMonth() === calendarDate.value.getMonth(),
      tasks: tasks.value.filter((task) => task.dueDate === date),
    };
  });
});

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthOffset(amount: number): void {
  calendarDate.value = new Date(
    calendarDate.value.getFullYear(),
    calendarDate.value.getMonth() + amount,
    1,
  );
}

function isOverdue(task: TaskSummary): boolean {
  return Boolean(task.dueDate && task.dueDate < formatDate(new Date()) && task.statusName !== "Done");
}

function priorityClass(priority: TaskPriority): string {
  return `task-priority--${priority.toLowerCase()}`;
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !submitting.value) taskDialogOpen.value = false;
}

function onTaskChanged(event: RealtimeTaskEvent): void {
  if (event.projectId !== props.project.id) return;
  void loadTasks();
  if (event.action === "labels-updated" && taskDetail.value) {
    void reloadDetail(taskDetail.value.id).catch((caught: unknown) => {
      error.value = caught instanceof Error ? caught.message : "Could not sync task changes.";
    });
    return;
  }
  if (taskDetail.value?.id === event.taskId) {
    if (event.action === "deleted") {
      taskDetail.value = null;
      taskDialogOpen.value = false;
    } else {
      void reloadDetail(event.taskId).catch((caught: unknown) => {
        error.value = caught instanceof Error ? caught.message : "Could not sync task changes.";
      });
    }
  }
}

function onPresenceChanged(event: { projectId: string; users: PresenceUser[] }): void {
  if (event.projectId === props.project.id) presenceUsers.value = event.users;
}

function onRealtimeConnectionError(): void {
  realtimeError.value = "Live updates are unavailable. The app will keep trying to reconnect.";
}

function onRealtimeConnected(): void {
  realtimeError.value = "";
}

onMounted(() => {
  void loadTasks();
  leaveProjectRoom = joinProjectRoom(props.project.id);
  realtime.on("task:changed", onTaskChanged);
  realtime.on("presence:update", onPresenceChanged);
  realtime.on("connect_error", onRealtimeConnectionError);
  realtime.on("connect", onRealtimeConnected);
});
watch(
  () => props.project.id,
  (projectId) => {
    leaveProjectRoom?.();
    presenceUsers.value = [];
    leaveProjectRoom = joinProjectRoom(projectId);
    void loadTasks();
  },
);
onBeforeUnmount(() => {
  leaveProjectRoom?.();
  realtime.off("task:changed", onTaskChanged);
  realtime.off("presence:update", onPresenceChanged);
  realtime.off("connect_error", onRealtimeConnectionError);
  realtime.off("connect", onRealtimeConnected);
});
</script>

<template>
  <section class="task-management">
    <header class="task-workspace-heading">
      <div>
        <p class="eyebrow">PROJECT WORK</p>
        <h2>Tasks <span class="task-count">{{ tasks.length }}</span></h2>
        <p class="page-subtitle">Plan and track the work in this project.</p>
      </div>
      <div class="task-heading-actions">
        <div
          v-if="presenceUsers.length"
          class="task-presence"
          :aria-label="`${presenceUsers.length} collaborators online`"
          :title="presenceUsers.map(({ name }) => name).join(', ')"
        >
          <span
            v-for="user in presenceUsers.slice(0, 4)"
            :key="user.id"
            class="task-presence-avatar"
            :aria-label="user.name"
          >{{ user.name.trim().charAt(0).toUpperCase() }}</span>
          <span v-if="presenceUsers.length > 4" class="task-presence-more">
            +{{ presenceUsers.length - 4 }}
          </span>
        </div>
        <button class="button button--quiet task-label-toggle" type="button" @click="labelDialogOpen = !labelDialogOpen">
          <Tag :size="15" /> Labels
        </button>
        <button class="button button--primary" type="button" @click="openCreate">
          <Plus :size="16" /> Add task
        </button>
      </div>
    </header>

    <p v-if="realtimeError" class="realtime-status" role="status">{{ realtimeError }}</p>
    <p v-if="error && !taskDialogOpen && !labelDialogOpen" class="project-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="project-loading" role="status">
      <LoaderCircle class="project-spinner" :size="20" /> Loading tasks…
    </div>
    <template v-else>
      <section v-if="labelDialogOpen" class="task-label-panel">
        <div class="task-label-panel-heading">
          <div>
            <h3>Project labels</h3>
            <p>Create reusable labels to organize tasks.</p>
          </div>
          <button class="icon-button" type="button" aria-label="Close labels" @click="labelDialogOpen = false"><X :size="16" /></button>
        </div>
        <form class="task-label-create" @submit.prevent="createLabel">
          <label class="sr-only" for="new-label-name">Label name</label>
          <input id="new-label-name" v-model="labelName" maxlength="40" placeholder="New label name" required />
          <label class="sr-only" for="new-label-color">Label color</label>
          <input id="new-label-color" v-model="labelColor" class="task-color-input" type="color" aria-label="New label color" />
          <button class="button button--primary" type="submit" :disabled="submitting"><Plus :size="14" /> Add label</button>
        </form>
        <ul v-if="labels.length" class="task-label-list">
          <li v-for="label in labels" :key="label.id">
            <template v-if="editingLabelId === label.id">
              <input v-model="editingLabelName" maxlength="40" aria-label="Edit label name" />
              <input v-model="editingLabelColor" class="task-color-input" type="color" aria-label="Edit label color" />
              <button class="icon-button" type="button" aria-label="Save label" @click="saveLabel(label)"><Check :size="15" /></button>
              <button class="icon-button" type="button" aria-label="Cancel edit" @click="editingLabelId = ''"><X :size="15" /></button>
            </template>
            <template v-else>
              <span class="task-label-chip" :style="{ '--label-color': label.color }">{{ label.name }} <small>{{ label.taskCount }}</small></span>
              <button class="icon-button" type="button" :aria-label="`Edit ${label.name}`" @click="startEditLabel(label)">Edit</button>
              <button class="icon-button icon-button--danger" type="button" :aria-label="`Delete ${label.name}`" @click="deleteLabel(label)"><Trash2 :size="14" /></button>
            </template>
          </li>
        </ul>
        <p v-else class="task-empty-note">No labels yet.</p>
        <p v-if="error && labelDialogOpen" class="project-error" role="alert">{{ error }}</p>
      </section>

      <nav class="task-view-tabs" aria-label="Task view">
        <button type="button" :aria-pressed="mode === 'kanban'" :class="{ 'is-active': mode === 'kanban' }" @click="mode = 'kanban'">
          <Columns3 :size="15" /> Board
        </button>
        <button type="button" :aria-pressed="mode === 'table'" :class="{ 'is-active': mode === 'table' }" @click="mode = 'table'">
          <List :size="15" /> Table
        </button>
        <button type="button" :aria-pressed="mode === 'calendar'" :class="{ 'is-active': mode === 'calendar' }" @click="mode = 'calendar'">
          <CalendarDays :size="15" /> Calendar
        </button>
      </nav>

      <div v-if="mode === 'kanban'" class="task-board">
        <section v-for="status in statuses" :key="status.id" class="task-column">
          <header class="task-column-heading">
            <span class="project-status-dot" :style="{ backgroundColor: status.color }"></span>
            <h3>{{ status.name }}</h3>
            <span class="task-column-count">{{ tasks.filter((task) => task.statusId === status.id).length }}</span>
            <button class="icon-button" type="button" :aria-label="`Add task to ${status.name}`" @click="openCreate(); draft.statusId = status.id"><Plus :size="15" /></button>
          </header>
          <div class="task-column-cards">
            <article
              v-for="task in tasks.filter((item) => item.statusId === status.id).sort((a, b) => a.position - b.position)"
              :key="task.id"
              class="task-card"
              tabindex="0"
              @click="openTask(task)"
              @keydown.enter="openTask(task)"
              @keydown.space.prevent="openTask(task)"
            >
              <div class="task-card-labels">
                <span v-for="label in task.labels" :key="label.id" class="task-label-chip" :style="{ '--label-color': label.color }">{{ label.name }}</span>
                <span class="task-priority" :class="priorityClass(task.priority)">{{ priorityLabels[task.priority] }}</span>
              </div>
              <h4>{{ task.title }}</h4>
              <p v-if="task.description" class="task-card-description">{{ task.description }}</p>
              <footer>
                <span v-if="task.dueDate" class="task-card-date" :class="{ 'is-overdue': isOverdue(task) }">
                  <CalendarDays :size="13" /> {{ task.dueDate }}
                </span>
                <span v-else></span>
                <span v-if="task.commentCount" class="task-comment-count"><MessageSquare :size="13" /> {{ task.commentCount }}</span>
                <span v-if="task.assignee" class="task-avatar" :title="task.assignee.name">{{ task.assignee.name.slice(0, 1).toUpperCase() }}</span>
              </footer>
              <label class="sr-only" :for="`move-${task.id}`">Move {{ task.title }} to status</label>
              <select :id="`move-${task.id}`" class="task-card-move" :value="task.statusId" @click.stop @change="moveTask(task, ($event.target as HTMLSelectElement).value)">
                <option v-for="option in statuses" :key="option.id" :value="option.id">{{ option.name }}</option>
              </select>
            </article>
            <button v-if="!tasks.some((task) => task.statusId === status.id)" class="task-column-empty" type="button" @click="openCreate(); draft.statusId = status.id">
              <CirclePlus :size="16" /> Add first task
            </button>
          </div>
        </section>
      </div>

      <div v-else-if="mode === 'table'" class="task-table-wrap">
        <table class="task-table">
          <thead>
            <tr><th>Task</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Due date</th><th>Labels</th><th>Comments</th></tr>
          </thead>
          <tbody>
            <tr v-for="task in sortedTasks" :key="task.id">
              <td><button class="task-table-title" type="button" @click="openTask(task)">{{ task.title }}</button></td>
              <td><select :value="task.statusId" :aria-label="`Status for ${task.title}`" @change="moveTask(task, ($event.target as HTMLSelectElement).value)"><option v-for="status in statuses" :key="status.id" :value="status.id">{{ status.name }}</option></select></td>
              <td><span class="task-priority" :class="priorityClass(task.priority)">{{ priorityLabels[task.priority] }}</span></td>
              <td>{{ task.assignee?.name ?? "Unassigned" }}</td>
              <td :class="{ 'is-overdue': isOverdue(task) }">{{ task.dueDate ?? "—" }}</td>
              <td><span v-for="label in task.labels" :key="label.id" class="task-label-chip" :style="{ '--label-color': label.color }">{{ label.name }}</span></td>
              <td>{{ task.commentCount }}</td>
            </tr>
            <tr v-if="!tasks.length"><td colspan="7" class="task-table-empty">No tasks yet. Add a task to get started.</td></tr>
          </tbody>
        </table>
      </div>

      <section v-else class="task-calendar">
        <header class="task-calendar-toolbar">
          <div class="task-calendar-month">
            <button class="icon-button" type="button" aria-label="Previous month" @click="monthOffset(-1)"><ChevronLeft :size="18" /></button>
            <h3>{{ calendarMonthLabel }}</h3>
            <button class="icon-button" type="button" aria-label="Next month" @click="monthOffset(1)"><ChevronRight :size="18" /></button>
          </div>
          <button class="button button--quiet" type="button" @click="calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1)">Today</button>
        </header>
        <div class="task-calendar-grid">
          <div v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="task-calendar-weekday">{{ day }}</div>
          <div v-for="cell in calendarCells" :key="cell.date" class="task-calendar-cell" :class="{ 'is-outside-month': !cell.inMonth, 'is-today': cell.date === formatDate(new Date()) }">
            <span class="task-calendar-day">{{ cell.day }}</span>
            <button v-for="task in cell.tasks" :key="task.id" type="button" class="task-calendar-item" :style="{ '--status-color': task.statusColor }" @click="openTask(task)">
              {{ task.title }}
            </button>
          </div>
        </div>
        <p v-if="!tasks.some((task) => task.dueDate)" class="task-empty-note">Tasks with a due date will appear on the calendar.</p>
      </section>
    </template>

    <div v-if="taskDialogOpen" class="task-dialog-backdrop" @click.self="taskDialogOpen = false" @keydown="onDialogKeydown">
      <section class="task-dialog" role="dialog" aria-modal="true" :aria-label="taskDetail ? 'Edit task' : 'Create task'">
        <header class="task-dialog-header">
          <div>
            <p class="eyebrow">{{ taskDetail ? "TASK DETAILS" : "NEW TASK" }}</p>
            <h2>{{ taskDetail ? "Update task" : "Create a task" }}</h2>
          </div>
          <button class="icon-button" type="button" aria-label="Close task dialog" @click="taskDialogOpen = false"><X :size="18" /></button>
        </header>
        <form class="task-form" @submit.prevent="saveTask">
          <label class="project-field">
            <span>Title</span>
            <input v-model="draft.title" maxlength="200" required autofocus placeholder="What needs to be done?" />
          </label>
          <label class="project-field">
            <span>Description</span>
            <textarea v-model="draft.description" maxlength="10000" rows="3" placeholder="Add details or acceptance notes"></textarea>
          </label>
          <div class="task-form-grid">
            <label class="project-field">
              <span>Status</span>
              <select v-model="draft.statusId" required><option v-for="status in statuses" :key="status.id" :value="status.id">{{ status.name }}</option></select>
            </label>
            <label class="project-field">
              <span>Priority</span>
              <select v-model="draft.priority"><option v-for="(label, value) in priorityLabels" :key="value" :value="value">{{ label }}</option></select>
            </label>
            <label class="project-field">
              <span>Assignee</span>
              <select v-model="draft.assigneeId"><option value="">Unassigned</option><option v-for="member in members" :key="member.id" :value="member.id">{{ member.name }} ({{ member.email }})</option></select>
            </label>
            <label class="project-field">
              <span>Start date</span>
              <input v-model="draft.startDate" type="date" />
            </label>
            <label class="project-field">
              <span>Due date</span>
              <input v-model="draft.dueDate" type="date" />
            </label>
          </div>
          <fieldset v-if="labels.length" class="task-label-picker">
            <legend>Labels</legend>
            <label v-for="label in labels" :key="label.id" class="task-label-option">
              <input v-model="draft.labelIds" type="checkbox" :value="label.id" />
              <span class="task-label-chip" :style="{ '--label-color': label.color }">{{ label.name }}</span>
            </label>
          </fieldset>
          <p v-if="error && taskDialogOpen" class="project-error" role="alert">{{ error }}</p>
          <footer class="task-dialog-actions">
            <button v-if="taskDetail" class="button button--danger" type="button" :disabled="submitting" @click="deleteTask"><Trash2 :size="14" /> Delete</button>
            <span class="task-dialog-spacer"></span>
            <button class="button button--quiet" type="button" :disabled="submitting" @click="taskDialogOpen = false">Cancel</button>
            <button class="button button--primary" type="submit" :disabled="submitting || !draft.statusId">
              <LoaderCircle v-if="submitting" class="project-spinner" :size="15" />
              <Check v-else :size="15" />
              {{ submitting ? "Saving…" : taskDetail ? "Save task" : "Create task" }}
            </button>
          </footer>
        </form>

        <template v-if="taskDetail">
          <section class="task-detail-section">
            <h3><ArrowRight :size="15" /> Dependencies</h3>
            <ul v-if="taskDetail.dependencies.length" class="task-detail-list">
              <li v-for="dependency in taskDetail.dependencies" :key="dependency.id">
                <span><strong>{{ dependency.title }}</strong><small>{{ dependency.statusName }}</small></span>
                <button class="icon-button icon-button--danger" type="button" :aria-label="`Remove dependency ${dependency.title}`" @click="removeDependency(dependency.id)"><X :size="14" /></button>
              </li>
            </ul>
            <form v-if="taskDetail.availableDependencies.length" class="task-inline-form" @submit.prevent="addDependency">
              <label class="sr-only" for="dependency-select">Select a task this task depends on</label>
              <select id="dependency-select" v-model="dependencyId" required>
                <option value="" disabled>Depends on…</option>
                <option v-for="dependency in taskDetail.availableDependencies" :key="dependency.id" :value="dependency.id">{{ dependency.title }} · {{ dependency.statusName }}</option>
              </select>
              <button class="button button--quiet" type="submit" :disabled="submitting"><Plus :size="14" /> Add</button>
            </form>
            <p v-else-if="!taskDetail.dependencies.length" class="task-empty-note">No other tasks available to link.</p>
          </section>
          <section class="task-detail-section">
            <h3><MessageSquare :size="15" /> Comments <span class="task-count">{{ taskDetail.comments.length }}</span></h3>
            <ul v-if="taskDetail.comments.length" class="task-comments">
              <li v-for="comment in taskDetail.comments" :key="comment.id">
                <div class="task-comment-meta"><strong>{{ comment.author.name }}</strong><time :datetime="comment.createdAt">{{ new Date(comment.createdAt).toLocaleString() }}</time></div>
                <p>{{ comment.body }}</p>
                <div v-if="comment.canEdit" class="task-comment-actions">
                  <button type="button" @click="editComment(comment)">Edit</button>
                  <button type="button" class="is-danger" @click="deleteComment(comment)">Delete</button>
                </div>
              </li>
            </ul>
            <form class="task-comment-form" @submit.prevent="addComment">
              <label class="sr-only" for="task-comment">Add a comment</label>
              <textarea id="task-comment" v-model="commentDraft" maxlength="5000" rows="2" placeholder="Write a comment; use @email to mention a workspace member…" required></textarea>
              <button class="button button--primary" type="submit" :disabled="submitting || !commentDraft.trim()"><Plus :size="14" /> Comment</button>
            </form>
          </section>
        </template>
      </section>
    </div>
  </section>
</template>
