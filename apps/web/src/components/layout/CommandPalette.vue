<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ArrowUpRight, Command, Search } from "@lucide/vue";
import { mainNavigation } from "../../lib/navigation";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const query = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const selectedIndex = ref(0);

const matches = computed(() => {
  const search = query.value.trim().toLowerCase();
  return mainNavigation.filter((item) => !search || item.label.toLowerCase().includes(search));
});
const activeResult = computed(() => matches.value[selectedIndex.value]);

watch(
  () => props.open,
  async (open) => {
    if (open) {
      query.value = "";
      await nextTick();
      searchInput.value?.focus();
    }
  },
);

watch(query, () => {
  selectedIndex.value = 0;
});

function navigate(name: string): void {
  void router.push({ name });
  emit("close");
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" && matches.value.length > 0) {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % matches.value.length;
  } else if (event.key === "ArrowUp" && matches.value.length > 0) {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value - 1 + matches.value.length) % matches.value.length;
  } else if (event.key === "Enter") {
    const selected = matches.value[selectedIndex.value];
    if (selected) {
      event.preventDefault();
      navigate(selected.name);
    }
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop command-backdrop" @click.self="emit('close')">
      <section
        class="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-title"
        @keydown.esc="emit('close')"
      >
        <h2 id="command-title" class="sr-only">Search ORBIT</h2>
        <div class="command-search">
          <Search :size="19" aria-hidden="true" />
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            placeholder="Search pages and actions..."
            aria-label="Search pages and actions"
            autocomplete="off"
            aria-controls="command-results-list"
            :aria-activedescendant="
              activeResult ? `command-result-${activeResult.name}` : undefined
            "
            @keydown="handleSearchKeydown"
          />
          <kbd>ESC</kbd>
        </div>
        <div id="command-results-list" class="command-results" role="listbox" aria-label="Pages">
          <p class="command-label">Navigate to</p>
          <button
            v-for="item in matches"
            :key="item.name"
            :id="`command-result-${item.name}`"
            class="command-result"
            :class="{ 'command-result--active': matches[selectedIndex]?.name === item.name }"
            role="option"
            :aria-selected="matches[selectedIndex]?.name === item.name"
            type="button"
            @mouseenter="selectedIndex = matches.findIndex((match) => match.name === item.name)"
            @click="navigate(item.name)"
          >
            <component :is="item.icon" :size="17" />
            <span>{{ item.label }}</span>
            <ArrowUpRight class="command-result-arrow" :size="15" />
          </button>
          <p v-if="matches.length === 0" class="command-empty">No pages match “{{ query }}”.</p>
        </div>
        <footer class="command-footer">
          <span><Command :size="13" /> K to search</span>
          <span>↑↓ to navigate <span class="command-divider">·</span> Enter to select</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
