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
</script>

<template>
  <section class="section-page">
    <p class="eyebrow">WORKSPACE PREVIEW</p>
    <h1>{{ title }}</h1>
    <p class="page-subtitle">{{ description }}</p>
    <div class="section-placeholder">
      <span class="section-placeholder-icon"><Sparkles :size="19" /></span>
      <h2>This area is part of the ORBIT preview.</h2>
      <p>
        The Stage 2 frontend does not fetch workspace data or perform {{ title.toLowerCase() }} actions
        yet. The feature will be connected in a later stage.
      </p>
      <RouterLink class="subtle-link" :to="{ name: 'overview' }">
        Back to overview <ArrowRight :size="14" />
      </RouterLink>
      <span class="stage-label">PREVIEW ONLY · FEATURES NOT CONNECTED</span>
    </div>
  </section>
</template>
