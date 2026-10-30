<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import {
  Bell,
  Check,
  ChevronDown,
  Command,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  UserRound,
  X,
} from "@lucide/vue";
import AppSidebar from "./AppSidebar.vue";
import CommandPalette from "./CommandPalette.vue";
import { useAuthStore } from "../../stores/auth";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const sidebarCollapsed = ref(false);
const mobileSidebarOpen = ref(false);
const commandOpen = ref(false);
const notificationsOpen = ref(false);
const profileOpen = ref(false);
const workspaceOpen = ref(false);
const signOutError = ref("");
const routeTitles = new Map<string, string>([
  ["overview", "Overview"],
  ["my-tasks", "My tasks"],
  ["inbox", "Inbox"],
  ["projects", "Projects"],
  ["calendar", "Calendar"],
  ["analytics", "Analytics"],
  ["settings", "Settings"],
]);

function openCommand(): void {
  commandOpen.value = true;
  notificationsOpen.value = false;
  profileOpen.value = false;
  workspaceOpen.value = false;
}

function closePopovers(): void {
  if (notificationsOpen.value || profileOpen.value || workspaceOpen.value) {
    notificationsOpen.value = false;
    profileOpen.value = false;
    workspaceOpen.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommand();
  }
  if (event.key === "Escape") {
    commandOpen.value = false;
    mobileSidebarOpen.value = false;
    closePopovers();
  }
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));

function createProject(): void {
  void router.push({ name: "projects" });
}

async function signOut(): Promise<void> {
  signOutError.value = "";
  try {
    await auth.logout();
    profileOpen.value = false;
    await router.replace({ name: "login" });
  } catch (error) {
    signOutError.value =
      error instanceof Error ? error.message : "Could not sign out. Please try again.";
  }
}

</script>

<template>
  <div v-if="auth.user" class="app-frame" @click="closePopovers">
    <AppSidebar
      :collapsed="sidebarCollapsed && !mobileSidebarOpen"
      :mobile-open="mobileSidebarOpen"
      :workspace-open="workspaceOpen"
      :user="auth.user"
      @navigate="
        mobileSidebarOpen = false;
        workspaceOpen = false;
      "
      @toggle-workspace="
        workspaceOpen = !workspaceOpen;
        notificationsOpen = false;
        profileOpen = false;
      "
      @create-project="createProject"
    />

    <div class="app-main">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="icon-button mobile-menu-button"
            type="button"
            :aria-label="mobileSidebarOpen ? 'Close navigation' : 'Open navigation'"
            @click="mobileSidebarOpen = !mobileSidebarOpen"
          >
            <X v-if="mobileSidebarOpen" :size="19" />
            <Menu v-else :size="19" />
          </button>
          <button
            class="icon-button collapse-button"
            type="button"
            :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <PanelLeftOpen v-if="sidebarCollapsed" :size="18" />
            <PanelLeftClose v-else :size="18" />
          </button>
          <div class="topbar-breadcrumb">
            <span class="breadcrumb-muted">Workspace</span>
            <span class="breadcrumb-slash">/</span>
            <span class="breadcrumb-current">{{ routeTitles.get(String(route.name)) ?? "Overview" }}</span>
          </div>
        </div>

        <div class="topbar-actions">
          <button class="search-trigger" type="button" @click="openCommand">
            <Search :size="16" />
            <span>Search anything</span>
            <kbd><Command :size="11" /> K</kbd>
          </button>

          <div class="popover-anchor">
            <button
              class="icon-button topbar-icon"
              type="button"
              aria-label="Notifications"
              :aria-expanded="notificationsOpen"
              @click.stop="
                notificationsOpen = !notificationsOpen;
                profileOpen = false;
                workspaceOpen = false;
              "
            >
              <Bell :size="18" />
            </button>
            <section v-if="notificationsOpen" class="popover notification-popover" @click.stop>
              <div class="popover-heading">
                <div>
                  <h2>Notifications</h2>
                  <p>Your workspace updates</p>
                </div>
                <span class="quiet-badge">Preview</span>
              </div>
              <div class="notification-empty">
                <span class="notification-empty-icon"><Check :size="17" /></span>
                <p>No notifications yet</p>
                <span>Notifications will appear here in a later stage.</span>
              </div>
            </section>
          </div>

          <div class="popover-anchor">
            <button
              class="profile-trigger"
              type="button"
              aria-label="Open account menu"
              :aria-expanded="profileOpen"
              @click.stop="
                profileOpen = !profileOpen;
                notificationsOpen = false;
                workspaceOpen = false;
              "
            >
              <span class="user-avatar" aria-hidden="true">{{
                auth.user.name.trim().charAt(0).toUpperCase()
              }}</span>
              <ChevronDown class="profile-chevron" :size="14" />
            </button>
            <section v-if="profileOpen" class="popover profile-popover" @click.stop>
              <div class="profile-popover-intro">
                <span class="user-avatar" aria-hidden="true">{{
                  auth.user.name.trim().charAt(0).toUpperCase()
                }}</span>
                <div><strong>{{ auth.user.name }}</strong><span>{{ auth.user.email }}</span></div>
              </div>
              <RouterLink class="popover-link" :to="{ name: 'settings' }" @click="profileOpen = false">
                <UserRound :size="16" /> Profile
              </RouterLink>
              <RouterLink class="popover-link" :to="{ name: 'settings' }" @click="profileOpen = false">
                <Settings2 :size="16" /> Settings
              </RouterLink>
              <div class="popover-separator"></div>
              <p v-if="signOutError" class="auth-notice" role="alert">{{ signOutError }}</p>
              <button
                class="popover-link popover-link--muted popover-link--button"
                type="button"
                @click="signOut"
              >
                <LogOut :size="16" /> Sign out
              </button>
            </section>
          </div>
        </div>
      </header>

      <main class="page-content">
        <RouterView />
      </main>
    </div>
    <CommandPalette :open="commandOpen" @close="commandOpen = false" />
  </div>
</template>
