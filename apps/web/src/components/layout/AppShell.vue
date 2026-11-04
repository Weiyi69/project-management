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
import type { NotificationSummary } from "@orbit/contracts";
import AppSidebar from "./AppSidebar.vue";
import CommandPalette from "./CommandPalette.vue";
import { notificationApi } from "../../lib/notification-api";
import { notificationMessage } from "../../lib/notification-presentation";
import { connectRealtime, disconnectRealtime, getRealtimeSocket } from "../../lib/realtime";
import { useAuthStore } from "../../stores/auth";
import { useWorkspaceStore } from "../../stores/workspaces";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const sidebarCollapsed = ref(false);
const mobileSidebarOpen = ref(false);
const commandOpen = ref(false);
const notificationsOpen = ref(false);
const profileOpen = ref(false);
const workspaceOpen = ref(false);
const signOutError = ref("");
const notifications = ref<NotificationSummary[]>([]);
const unreadNotificationCount = ref(0);
const notificationError = ref("");
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

function addNotification(notification: NotificationSummary): void {
  const index = notifications.value.findIndex(({ id }) => id === notification.id);
  if (index >= 0) {
    notifications.value[index] = notification;
    return;
  }
  notifications.value.unshift(notification);
  if (notification.readAt === null) unreadNotificationCount.value += 1;
}

async function openNotification(notification: NotificationSummary): Promise<void> {
  notificationError.value = "";
  try {
    if (notification.readAt === null) {
      await notificationApi.markRead(notification.id);
      if (notification.readAt === null) {
        notification.readAt = new Date().toISOString();
        unreadNotificationCount.value = Math.max(0, unreadNotificationCount.value - 1);
      }
    }
    notificationsOpen.value = false;
    if (notification.task) {
      await router.push({ name: "project-detail", params: { projectId: notification.task.projectId } });
    }
  } catch (caught) {
    notificationError.value =
      caught instanceof Error ? caught.message : "Could not open this notification.";
  }
}

async function markAllNotificationsRead(): Promise<void> {
  notificationError.value = "";
  try {
    await notificationApi.markAllRead();
    const readAt = new Date().toISOString();
    notifications.value = notifications.value.map((notification) => ({
      ...notification,
      readAt,
    }));
    unreadNotificationCount.value = 0;
  } catch (caught) {
    notificationError.value =
      caught instanceof Error ? caught.message : "Could not mark notifications as read.";
  }
}

const realtime = getRealtimeSocket();
function onRealtimeNotification(notification: NotificationSummary): void {
  addNotification(notification);
}

function onRealtimeDisconnect(reason: string): void {
  if (reason !== "io server disconnect" || !auth.user) return;
  auth.expireSession();
  void router.replace({ name: "login", query: { reason: "session-expired" } });
}

function onNotificationRead(event: { id: string; readAt: string }): void {
  const notification = notifications.value.find(({ id }) => id === event.id);
  if (!notification || notification.readAt !== null) return;
  notification.readAt = event.readAt;
  unreadNotificationCount.value = Math.max(0, unreadNotificationCount.value - 1);
}

function onNotificationsReadAll(event: { readAt: string }): void {
  notifications.value = notifications.value.map((notification) => ({
    ...notification,
    readAt: notification.readAt ?? event.readAt,
  }));
  unreadNotificationCount.value = 0;
}

onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  void workspaces.load(auth.user?.workspaceId).catch((caught: unknown) => {
    workspaces.error =
      caught instanceof Error ? caught.message : "Could not load your workspaces.";
  });
  realtime.on("notification:new", onRealtimeNotification);
  realtime.on("notification:read", onNotificationRead);
  realtime.on("notifications:read-all", onNotificationsReadAll);
  realtime.on("disconnect", onRealtimeDisconnect);
  connectRealtime();
  void notificationApi.list().then(
    (response) => {
      const liveNotifications = notifications.value.filter(
        ({ id }) => !response.notifications.some((notification) => notification.id === id),
      );
      notifications.value = [...liveNotifications, ...response.notifications];
      unreadNotificationCount.value =
        response.unreadCount + liveNotifications.filter(({ readAt }) => readAt === null).length;
      notificationError.value = "";
    },
    (caught: unknown) => {
      notificationError.value =
        caught instanceof Error ? caught.message : "Could not load notifications.";
    },
  );
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  realtime.off("notification:new", onRealtimeNotification);
  realtime.off("notification:read", onNotificationRead);
  realtime.off("notifications:read-all", onNotificationsReadAll);
  realtime.off("disconnect", onRealtimeDisconnect);
  disconnectRealtime();
});

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

function selectWorkspace(workspaceId: string): void {
  workspaces.select(workspaceId);
  workspaceOpen.value = false;
  void router.push({ name: "projects" });
}

</script>

<template>
  <div v-if="auth.user" class="app-frame" @click="closePopovers">
    <AppSidebar
      :collapsed="sidebarCollapsed && !mobileSidebarOpen"
      :mobile-open="mobileSidebarOpen"
      :workspace-open="workspaceOpen"
      :workspaces="workspaces.workspaces"
      :selected-workspace-id="workspaces.selectedId"
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
      @select-workspace="selectWorkspace"
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
          <button
            class="search-trigger"
            type="button"
            aria-label="Search anything K"
            @click="openCommand"
          >
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
              <span v-if="unreadNotificationCount" class="notification-count" aria-live="polite">
                {{ unreadNotificationCount > 99 ? "99+" : unreadNotificationCount }}
              </span>
            </button>
            <section v-if="notificationsOpen" class="popover notification-popover" @click.stop>
              <div class="popover-heading">
                <div>
                  <h2>Notifications</h2>
                  <p>{{ unreadNotificationCount }} unread</p>
                </div>
                <button
                  v-if="unreadNotificationCount"
                  class="notification-mark-read"
                  type="button"
                  @click="markAllNotificationsRead"
                >
                  Mark all read
                </button>
              </div>
              <p v-if="notificationError" class="notification-error" role="alert">
                {{ notificationError }}
              </p>
              <ul v-if="notifications.length" class="notification-list">
                <li v-for="notification in notifications" :key="notification.id">
                  <button
                    class="notification-item"
                    :class="{ 'notification-item--unread': notification.readAt === null }"
                    type="button"
                    @click="openNotification(notification)"
                  >
                    <span class="notification-item-dot" aria-hidden="true"></span>
                    <span class="notification-item-copy">
                      <span>{{ notificationMessage(notification) }}</span>
                      <small>{{ notification.task?.projectName ?? "ORBIT" }}</small>
                    </span>
                  </button>
                </li>
              </ul>
              <div v-else class="notification-empty">
                <span class="notification-empty-icon"><Check :size="17" /></span>
                <p>No notifications yet</p>
                <span>Task assignments and mentions will appear here.</span>
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
        <p v-if="workspaces.error" class="project-error workspace-global-error" role="alert">
          {{ workspaces.error }}
        </p>
        <RouterView />
      </main>
    </div>
    <CommandPalette :open="commandOpen" @close="commandOpen = false" />
  </div>
</template>
