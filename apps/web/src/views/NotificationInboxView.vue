<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { Bell, Check, LoaderCircle } from "@lucide/vue";
import { useRouter } from "vue-router";
import type { NotificationSummary } from "@orbit/contracts";
import { notificationApi } from "../lib/notification-api";
import { notificationMessage } from "../lib/notification-presentation";
import { getRealtimeSocket } from "../lib/realtime";

const router = useRouter();
const notifications = ref<NotificationSummary[]>([]);
const unreadCount = ref(0);
const loading = ref(true);
const error = ref("");
const realtime = getRealtimeSocket();

function addNotification(notification: NotificationSummary): void {
  const index = notifications.value.findIndex(({ id }) => id === notification.id);
  if (index >= 0) {
    notifications.value[index] = notification;
    return;
  }
  notifications.value.unshift(notification);
  if (notification.readAt === null) unreadCount.value += 1;
}

function onNotificationRead(event: { id: string; readAt: string }): void {
  const notification = notifications.value.find(({ id }) => id === event.id);
  if (!notification || notification.readAt !== null) return;
  notification.readAt = event.readAt;
  unreadCount.value = Math.max(0, unreadCount.value - 1);
}

function onNotificationsReadAll(event: { readAt: string }): void {
  notifications.value = notifications.value.map((notification) => ({
    ...notification,
    readAt: notification.readAt ?? event.readAt,
  }));
  unreadCount.value = 0;
}

async function loadNotifications(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const response = await notificationApi.list();
    const liveNotifications = notifications.value.filter(
      ({ id }) => !response.notifications.some((notification) => notification.id === id),
    );
    notifications.value = [...liveNotifications, ...response.notifications];
    unreadCount.value =
      response.unreadCount + liveNotifications.filter(({ readAt }) => readAt === null).length;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load notifications.";
  } finally {
    loading.value = false;
  }
}

async function openNotification(notification: NotificationSummary): Promise<void> {
  error.value = "";
  try {
    if (notification.readAt === null) {
      await notificationApi.markRead(notification.id);
      if (notification.readAt === null) {
        notification.readAt = new Date().toISOString();
        unreadCount.value = Math.max(0, unreadCount.value - 1);
      }
    }
    if (notification.task) {
      await router.push({ name: "project-detail", params: { projectId: notification.task.projectId } });
    } else if (notification.project) {
      await router.push({ name: "project-detail", params: { projectId: notification.project.id } });
    } else if (notification.workspaceInvitation) {
      await router.push({ name: "overview" });
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not open this notification.";
  }
}

async function markAllRead(): Promise<void> {
  error.value = "";
  try {
    await notificationApi.markAllRead();
    const readAt = new Date().toISOString();
    notifications.value = notifications.value.map((notification) => ({
      ...notification,
      readAt: notification.readAt ?? readAt,
    }));
    unreadCount.value = 0;
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : "Could not mark notifications as read.";
  }
}

onMounted(() => {
  realtime.on("notification:new", addNotification);
  realtime.on("notification:read", onNotificationRead);
  realtime.on("notifications:read-all", onNotificationsReadAll);
  void loadNotifications();
});

onBeforeUnmount(() => {
  realtime.off("notification:new", addNotification);
  realtime.off("notification:read", onNotificationRead);
  realtime.off("notifications:read-all", onNotificationsReadAll);
});
</script>

<template>
  <section class="inbox-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">UPDATES</p>
        <h1>Inbox</h1>
        <p class="page-subtitle">
          Task assignments and mentions
          <span v-if="unreadCount">· {{ unreadCount }} unread</span>
        </p>
      </div>
      <button
        v-if="unreadCount"
        class="button button--quiet"
        type="button"
        @click="markAllRead"
      >
        <Check :size="15" /> Mark all read
      </button>
    </header>

    <p v-if="error" class="project-error" role="alert">{{ error }}</p>
    <div v-if="loading" class="project-loading" role="status">
      <LoaderCircle class="project-spinner" :size="20" /> Loading inbox…
    </div>
    <div v-else-if="notifications.length" class="inbox-notification-list">
      <button
        v-for="notification in notifications"
        :key="notification.id"
        class="inbox-notification"
        :class="{ 'inbox-notification--unread': notification.readAt === null }"
        type="button"
        @click="openNotification(notification)"
      >
        <span class="inbox-notification-icon"><Bell :size="16" /></span>
        <span class="inbox-notification-copy">
          <strong>{{ notificationMessage(notification) }}</strong>
          <span>{{ notification.task?.projectName ?? notification.project?.name ?? notification.workspaceInvitation?.workspaceName ?? "ORBIT" }}</span>
        </span>
        <time :datetime="notification.createdAt">
          {{ new Date(notification.createdAt).toLocaleString() }}
        </time>
        <span v-if="notification.readAt === null" class="inbox-unread-indicator">Unread</span>
      </button>
    </div>
    <div v-else class="inbox-empty">
      <span class="notification-empty-icon"><Check :size="17" /></span>
      <h2>You're all caught up</h2>
      <p>Task assignments and mentions will appear here.</p>
    </div>
  </section>
</template>
