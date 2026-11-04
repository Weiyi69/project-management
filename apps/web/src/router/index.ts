import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import AppShell from "../components/layout/AppShell.vue";
import AuthView from "../views/AuthView.vue";
import AcceptInvitationView from "../views/AcceptInvitationView.vue";
import AnalyticsProjectView from "../views/AnalyticsProjectView.vue";
import AnalyticsView from "../views/AnalyticsView.vue";
import NotificationInboxView from "../views/NotificationInboxView.vue";
import MyTasksView from "../views/MyTasksView.vue";
import ProjectDetailView from "../views/ProjectDetailView.vue";
import ProjectsView from "../views/ProjectsView.vue";
import WorkspaceOverview from "../views/WorkspaceOverview.vue";
import WorkspaceCalendarView from "../views/WorkspaceCalendarView.vue";
import WorkspaceSettingsView from "../views/WorkspaceSettingsView.vue";
import AccountSettingsView from "../views/AccountSettingsView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: AppShell,
      children: [
        { path: "", redirect: { name: "overview" } },
        {
          path: "overview",
          name: "overview",
          component: WorkspaceOverview,
          meta: { title: "Overview" },
        },
        {
          path: "my-tasks",
          name: "my-tasks",
          component: MyTasksView,
          meta: {
            title: "My tasks",
            description: "Your assigned work, gathered in one place.",
          },
        },
        {
          path: "inbox",
          name: "inbox",
          component: NotificationInboxView,
          meta: {
            title: "Inbox",
            description: "Updates and mentions from your workspace.",
          },
        },
        {
          path: "projects",
          name: "projects",
          component: ProjectsView,
          meta: {
            title: "Projects",
            description: "Plan work, bring people together, and keep momentum.",
          },
        },
        {
          path: "projects/:projectId",
          name: "project-detail",
          component: ProjectDetailView,
          meta: {
            title: "Project",
          },
        },
        {
          path: "calendar",
          name: "calendar",
          component: WorkspaceCalendarView,
          meta: {
            title: "Calendar",
            description: "See important dates and upcoming work.",
          },
        },
        {
          path: "analytics",
          name: "analytics",
          component: AnalyticsView,
          meta: {
            title: "Analytics",
            description: "Understand progress and the health of your projects.",
          },
        },
        {
          path: "analytics/projects/:projectId",
          name: "analytics-project",
          component: AnalyticsProjectView,
          meta: { title: "Project analytics" },
        },
        {
          path: "settings",
          name: "settings",
          component: WorkspaceSettingsView,
          meta: {
            title: "Settings",
            description: "Manage the selected workspace.",
          },
        },
        {
          path: "account/profile",
          name: "account-profile",
          component: AccountSettingsView,
          meta: { title: "Profile", description: "Manage your personal account." },
        },
        {
          path: "account/notifications",
          name: "account-notifications",
          component: AccountSettingsView,
          meta: { title: "Notifications", description: "Choose how ORBIT notifies you." },
        },
        {
          path: "account/security",
          name: "account-security",
          component: AccountSettingsView,
          meta: { title: "Security", description: "Manage your password and sessions." },
        },
      ],
    },
    {
      path: "/login",
      name: "login",
      component: AuthView,
      meta: { title: "Sign in", public: true },
    },
    {
      path: "/register",
      name: "register",
      component: AuthView,
      meta: { title: "Create account", public: true },
    },
    {
      path: "/verify-email",
      name: "verify-email",
      component: AuthView,
      meta: { title: "Verify email", public: true },
    },
    {
      path: "/forgot-password",
      name: "forgot-password",
      component: AuthView,
      meta: { title: "Reset password", public: true },
    },
    {
      path: "/reset-password",
      name: "reset-password",
      component: AuthView,
      meta: { title: "Choose a new password", public: true },
    },
    {
      path: "/invitations/accept",
      name: "invitation-accept",
      component: AcceptInvitationView,
      meta: { title: "Accept invitation", public: true },
    },
    {
      path: "/:pathMatch(.*)*",
      redirect: { name: "overview" },
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.initialized) {
    try {
      await auth.initialize();
    } catch {
      if (!to.meta.public) {
        return {
          name: "login",
          query: { redirect: to.fullPath, reason: "api-unavailable" },
        };
      }
    }
  }

  if (to.meta.public) {
    if (auth.user && (to.name === "login" || to.name === "register")) {
      return { name: "overview" };
    }
    return true;
  }

  if (!auth.user) {
    return { name: "login", query: { redirect: to.fullPath } };
  }

  return true;
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "ORBIT")} — ORBIT`;
});
