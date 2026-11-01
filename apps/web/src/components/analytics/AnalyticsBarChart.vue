<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  title: string;
  items: Array<{ label: string; value: number; color?: string }>;
  emptyMessage: string;
}>();

const maximum = computed(() => Math.max(1, ...props.items.map((item) => item.value)));
</script>

<template>
  <section class="analytics-chart" :aria-label="title">
    <h3>{{ title }}</h3>
    <p v-if="items.length === 0" class="analytics-chart-empty">{{ emptyMessage }}</p>
    <div v-else class="analytics-bars" role="list">
      <div v-for="item in items" :key="item.label" class="analytics-bar-row" role="listitem">
        <span class="analytics-bar-label" :title="item.label">{{ item.label }}</span>
        <span
          class="analytics-bar-track"
          role="img"
          :aria-label="`${item.label}: ${item.value}`"
        >
          <span
            class="analytics-bar-fill"
            :style="{
              width: `${Math.max(item.value > 0 ? 4 : 0, (item.value / maximum) * 100)}%`,
              backgroundColor: item.color ?? 'var(--accent)',
            }"
          ></span>
        </span>
        <strong class="analytics-bar-value">{{ item.value }}</strong>
      </div>
    </div>
  </section>
</template>
