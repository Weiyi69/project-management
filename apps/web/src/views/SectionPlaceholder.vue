<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { ArrowRight, Sparkles } from "@lucide/vue";

const route = useRoute();
const title = computed(() =>
  typeof route.meta.title === "string" ? route.meta.title : "Workspace",
);
const description = computed(() =>
  typeof route.meta.description === "string" ? route.meta.description : "",
);
const previewCopy = computed(() => {
  if (route.name === "my-tasks") {
    return "Create, assign, and update tasks inside each project. A cross-project My tasks view is not connected yet.";
  }
  if (route.name === "calendar") {
    return "Calendar view is available in a project's Tasks section. A workspace-wide calendar is not connected yet.";
  }
  if (route.name === "inbox") {
    return "Workspace notifications and mentions will be connected in a later stage.";
  }
  if (route.name === "analytics") {
    return "Workspace and project analytics will be connected in a later stage.";
  }
  return "This feature will be connected in a later stage.";
});
</script>

<template>
  <section class="section-page">
    <p class="eyebrow">WORKSPACE PREVIEW</p>
    <h1>{{ title }}</h1>
    <p class="page-subtitle">{{ description }}</p>
    <div class="section-placeholder">
      <span class="section-placeholder-icon"><Sparkles :size="19" /></span>
      <h2>This area is part of the ORBIT preview.</h2>
      <p>{{ previewCopy }}</p>
      <RouterLink class="subtle-link" :to="{ name: 'overview' }">
        Back to overview <ArrowRight :size="14" />
      </RouterLink>
      <span class="stage-label">PREVIEW ONLY · FEATURES NOT CONNECTED</span>
    </div>
  </section>
</template>
