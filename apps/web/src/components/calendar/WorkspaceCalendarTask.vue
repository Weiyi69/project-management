<script setup lang="ts">
import { ArrowUpRight } from "@lucide/vue";
import { RouterLink } from "vue-router";
import type { WorkspaceCalendarTask } from "@orbit/contracts";

defineProps<{ task: WorkspaceCalendarTask }>();
const emit = defineEmits<{ open: [task: WorkspaceCalendarTask] }>();
</script>

<template>
  <article class="workspace-calendar-event">
    <button
      class="workspace-calendar-event-main"
      type="button"
      @click="emit('open', task)"
    >
      <span class="sr-only">Open task </span>
      <strong>{{ task.title }}</strong>
      <span class="sr-only">Due {{ task.dueDate }}</span>
      <span class="workspace-calendar-event-tags">
        <span class="workspace-calendar-status" :style="{ '--status-color': task.statusColor }">
          {{ task.statusName }}
        </span>
        <span class="task-priority" :class="`task-priority--${task.priority.toLowerCase()}`">
          {{ task.priority.toLowerCase() }}
        </span>
      </span>
      <span class="workspace-calendar-event-meta">{{ task.project.name }}</span>
      <span class="workspace-calendar-event-meta">
        {{ task.assignee?.name ?? "Unassigned" }}
      </span>
    </button>
    <RouterLink
      class="workspace-calendar-project-link"
      :to="{ name: 'project-detail', params: { projectId: task.projectId } }"
      :aria-label="`Open project ${task.project.name}`"
      :title="`Open ${task.project.name}`"
    >
      <ArrowUpRight :size="13" aria-hidden="true" />
    </RouterLink>
  </article>
</template>
