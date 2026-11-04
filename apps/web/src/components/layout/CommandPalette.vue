<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  ArrowUpRight,
  ClipboardList,
  Command,
  FolderKanban,
  LoaderCircle,
  Search,
} from "@lucide/vue";
import type {
  GlobalSearchProject,
  GlobalSearchTask,
} from "@orbit/contracts";
import { globalSearchApi } from "../../lib/global-search-api";
import { mainNavigation, settingsNavigation } from "../../lib/navigation";
import { trapFocusWithin } from "../../lib/dialog-accessibility";

type SearchPage = (typeof mainNavigation)[number];
type PaletteResult =
  | { type: "project"; id: string; project: GlobalSearchProject }
  | { type: "task"; id: string; task: GlobalSearchTask }
  | { type: "page"; id: string; page: SearchPage };
interface HighlightPart {
  text: string;
  matched: boolean;
}

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
const query = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
const selectedIndex = ref(0);
const retryVersion = ref(0);
const projects = ref<GlobalSearchProject[]>([]);
const tasks = ref<GlobalSearchTask[]>([]);
const loading = ref(false);
const error = ref("");
let restoreFocus: HTMLElement | null = null;
let requestId = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let activeRequest: AbortController | null = null;

const normalizedQuery = computed(() => query.value.normalize("NFKC").trim().replace(/\s+/gu, " "));
const pages = computed(() => {
  const search = normalizedQuery.value.toLocaleLowerCase();
  return [...mainNavigation, ...settingsNavigation].filter(
    (item) => !search || item.label.toLocaleLowerCase().includes(search),
  );
});
const results = computed<PaletteResult[]>(() => [
  ...projects.value.map((project) => ({ type: "project" as const, id: project.id, project })),
  ...tasks.value.map((task) => ({ type: "task" as const, id: task.id, task })),
  ...pages.value.map((page) => ({ type: "page" as const, id: page.name, page })),
]);
const activeResult = computed(() => results.value[selectedIndex.value]);
const queryIsSearchable = computed(() => Array.from(normalizedQuery.value).length >= 2);
const showEmptyState = computed(
  () =>
    queryIsSearchable.value &&
    !loading.value &&
    !error.value &&
    projects.value.length === 0 &&
    tasks.value.length === 0 &&
    pages.value.length === 0,
);

function resultId(result: PaletteResult): string {
  return `command-result-${result.type}-${result.id}`;
}

function highlightParts(value: string, search: string): HighlightPart[] {
  if (!search) return [{ text: value, matched: false }];
  const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const matcher = new RegExp(escapedSearch, "giu");
  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(matcher)) {
    const matchAt = match.index;
    const matchText = match[0];
    if (matchAt > cursor) parts.push({ text: value.slice(cursor, matchAt), matched: false });
    parts.push({ text: matchText, matched: true });
    cursor = matchAt + matchText.length;
  }
  if (cursor < value.length || parts.length === 0) {
    parts.push({ text: value.slice(cursor), matched: false });
  }
  return parts;
}

function cancelPendingSearch(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  activeRequest?.abort();
  activeRequest = null;
}

watch(
  () => [props.open, query.value, retryVersion.value] as const,
  ([open]) => {
    const currentRequestId = ++requestId;
    cancelPendingSearch();
    loading.value = false;
    error.value = "";
    projects.value = [];
    tasks.value = [];

    if (!open || !queryIsSearchable.value) return;

    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const controller = new AbortController();
      activeRequest = controller;
      loading.value = true;
      try {
        const response = await globalSearchApi.search(normalizedQuery.value, controller.signal);
        if (currentRequestId !== requestId || !props.open) return;
        projects.value = response.projects;
        tasks.value = response.tasks;
      } catch (caught) {
        if (currentRequestId !== requestId || !props.open) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        error.value =
          caught instanceof Error ? caught.message : "Could not search projects and tasks.";
      } finally {
        if (currentRequestId === requestId && props.open) {
          loading.value = false;
          activeRequest = null;
        }
      }
    }, 250);
  },
  { flush: "sync" },
);

watch(
  () => props.open,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      query.value = "";
      selectedIndex.value = 0;
      await nextTick();
      searchInput.value?.focus();
    } else {
      cancelPendingSearch();
      await nextTick();
      restoreFocus?.focus();
      restoreFocus = null;
    }
  },
);

watch(
  results,
  () => {
    selectedIndex.value = Math.min(selectedIndex.value, Math.max(0, results.value.length - 1));
  },
  { flush: "sync" },
);

watch(query, () => {
  selectedIndex.value = 0;
});

onBeforeUnmount(() => {
  requestId += 1;
  cancelPendingSearch();
});

function navigate(result: PaletteResult): void {
  if (result.type === "project") {
    void router.push({ name: "project-detail", params: { projectId: result.project.id } });
  } else if (result.type === "task") {
    void router.push({
      name: "project-detail",
      params: { projectId: result.task.projectId },
      query: { task: result.task.id },
    });
  } else {
    void router.push({ name: result.page.name });
  }
  emit("close");
}

function scrollActiveResultIntoView(): void {
  const result = activeResult.value;
  if (!result) return;
  document.getElementById(resultId(result))?.scrollIntoView({ block: "nearest" });
}

function handleSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" && results.value.length > 0) {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value + 1) % results.value.length;
    scrollActiveResultIntoView();
  } else if (event.key === "ArrowUp" && results.value.length > 0) {
    event.preventDefault();
    selectedIndex.value = (selectedIndex.value - 1 + results.value.length) % results.value.length;
    scrollActiveResultIntoView();
  } else if (event.key === "Enter") {
    const selected = activeResult.value;
    if (selected) {
      event.preventDefault();
      navigate(selected);
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

function trapDialogFocus(event: KeyboardEvent): void {
  trapFocusWithin(event, dialog.value);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop command-backdrop" @click.self="emit('close')">
      <section
        ref="dialog"
        class="command-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-title"
        tabindex="-1"
        @keydown.esc="emit('close')"
        @keydown="trapDialogFocus"
      >
        <h2 id="command-title" class="sr-only">Search ORBIT</h2>
        <div class="command-search">
          <Search :size="19" aria-hidden="true" />
          <input
            ref="searchInput"
            v-model="query"
            type="search"
            placeholder="Search projects, tasks, and pages..."
            aria-label="Search projects, tasks, and pages"
            autocomplete="off"
            aria-controls="command-results-list"
            :aria-activedescendant="activeResult ? resultId(activeResult) : undefined"
            @keydown="handleSearchKeydown"
          />
          <kbd>ESC</kbd>
        </div>
        <div
          id="command-results-list"
          ref="resultsElement"
          class="command-results"
          role="listbox"
          aria-label="Search results"
          aria-live="polite"
          :aria-busy="loading"
        >
          <div v-if="projects.length" role="group" aria-label="Projects">
            <p class="command-label">Projects</p>
            <button
              v-for="project in projects"
              :id="`command-result-project-${project.id}`"
              :key="project.id"
              class="command-result command-result--content"
              :class="{ 'command-result--active': activeResult?.type === 'project' && activeResult.id === project.id }"
              role="option"
              :aria-selected="activeResult?.type === 'project' && activeResult.id === project.id"
              type="button"
              @mouseenter="selectedIndex = results.findIndex((result) => result.type === 'project' && result.id === project.id)"
              @click="navigate({ type: 'project', id: project.id, project })"
            >
              <FolderKanban :size="16" aria-hidden="true" />
              <span class="command-result-copy">
                <strong>
                  <template v-for="(part, index) in highlightParts(project.name, normalizedQuery)" :key="`${index}-${part.text}`">
                    <mark v-if="part.matched">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </strong>
                <small>
                  <template v-for="(part, index) in highlightParts(project.description ?? project.workspace.name, normalizedQuery)" :key="`${index}-${part.text}`">
                    <mark v-if="part.matched">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                  <span v-if="project.description"> · {{ project.workspace.name }}</span>
                </small>
              </span>
              <ArrowUpRight class="command-result-arrow" :size="15" aria-hidden="true" />
            </button>
          </div>

          <div v-if="tasks.length" role="group" aria-label="Tasks">
            <p class="command-label">Tasks</p>
            <button
              v-for="task in tasks"
              :id="`command-result-task-${task.id}`"
              :key="task.id"
              class="command-result command-result--content"
              :class="{ 'command-result--active': activeResult?.type === 'task' && activeResult.id === task.id }"
              role="option"
              :aria-selected="activeResult?.type === 'task' && activeResult.id === task.id"
              type="button"
              @mouseenter="selectedIndex = results.findIndex((result) => result.type === 'task' && result.id === task.id)"
              @click="navigate({ type: 'task', id: task.id, task })"
            >
              <ClipboardList :size="16" aria-hidden="true" />
              <span class="command-result-copy">
                <strong>
                  <template v-for="(part, index) in highlightParts(task.title, normalizedQuery)" :key="`${index}-${part.text}`">
                    <mark v-if="part.matched">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </strong>
                <small>
                  <template v-for="(part, index) in highlightParts(task.description ?? task.project.name, normalizedQuery)" :key="`${index}-${part.text}`">
                    <mark v-if="part.matched">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                  <span v-if="task.description"> · {{ task.project.name }}</span>
                </small>
              </span>
              <ArrowUpRight class="command-result-arrow" :size="15" aria-hidden="true" />
            </button>
          </div>

          <div v-if="pages.length" role="group" aria-label="Pages">
            <p class="command-label">Pages</p>
            <button
              v-for="page in pages"
              :id="`command-result-page-${page.name}`"
              :key="page.name"
              class="command-result"
              :class="{ 'command-result--active': activeResult?.type === 'page' && activeResult.id === page.name }"
              role="option"
              :aria-selected="activeResult?.type === 'page' && activeResult.id === page.name"
              type="button"
              @mouseenter="selectedIndex = results.findIndex((result) => result.type === 'page' && result.id === page.name)"
              @click="navigate({ type: 'page', id: page.name, page })"
            >
              <component :is="page.icon" :size="17" aria-hidden="true" />
              <span>
                <template v-for="(part, index) in highlightParts(page.label, normalizedQuery)" :key="`${index}-${part.text}`">
                  <mark v-if="part.matched">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </span>
              <ArrowUpRight class="command-result-arrow" :size="15" aria-hidden="true" />
            </button>
          </div>

          <p v-if="!queryIsSearchable && normalizedQuery" class="command-empty">
            Type at least 2 characters to search projects and tasks.
          </p>
          <p v-if="loading" class="command-status" role="status">
            <LoaderCircle class="command-spinner" :size="16" /> Searching…
          </p>
          <p v-if="error" class="command-error" role="alert">
            {{ error }}
            <button class="command-retry" type="button" @click="retryVersion += 1">
              Try again
            </button>
          </p>
          <p v-if="showEmptyState" class="command-empty">No results match “{{ normalizedQuery }}”.</p>
          <p v-if="!normalizedQuery && !pages.length" class="command-empty">Search projects, tasks, and pages.</p>
        </div>
        <footer class="command-footer">
          <span><Command :size="13" /> K to search</span>
          <span>↑↓ to navigate <span class="command-divider">·</span> Enter to select</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
