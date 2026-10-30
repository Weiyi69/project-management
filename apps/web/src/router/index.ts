import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth";
import AppShell from "../components/layout/AppShell.vue";
import AuthView from "../views/AuthView.vue";
import SectionPlaceholder from "../views/SectionPlaceholder.vue";
import WorkspaceOverview from "../views/WorkspaceOverview.vue";

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
          component: SectionPlaceholder,
          meta: {
            title: "My tasks",
            description: "Your assigned work, gathered in one place.",
          },
        },
        {
          path: "inbox",
          name: "inbox",
          component: SectionPlaceholder,
          meta: {
            title: "Inbox",
            description: "Updates and mentions from your workspace.",
          },
        },
        {
          path: "projects",
          name: "projects",
          component: SectionPlaceholder,
          meta: {
            title: "Projects",
            description: "Plan work, bring people together, and keep momentum.",
          },
        },
        {
          path: "calendar",
          name: "calendar",
          component: SectionPlaceholder,
          meta: {
            title: "Calendar",
            description: "See important dates and upcoming work.",
          },
        },
        {
          path: "analytics",
          name: "analytics",
          component: SectionPlaceholder,
          meta: {
            title: "Analytics",
            description: "Understand progress and the health of your projects.",
          },
        },
        {
          path: "settings",
          name: "settings",
          component: SectionPlaceholder,
          meta: {
            title: "Settings",
            description: "Manage your workspace and personal preferences.",
          },
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
      path: "/forgot-password",
      name: "forgot-password",
      component: AuthView,
      meta: { title: "Reset password", public: true },
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
