<script setup lang="ts">
import { RouterLink, useRoute } from "vue-router";
import { ArrowUpRight, Check, ChevronDown, ChevronsUpDown } from "@lucide/vue";
import type { AuthenticatedUser } from "@orbit/contracts";
import { mainNavigation, settingsNavigation } from "../../lib/navigation";

defineProps<{
  collapsed: boolean;
  mobileOpen: boolean;
  workspaceOpen: boolean;
  user: AuthenticatedUser;
}>();

const emit = defineEmits<{
  navigate: [];
  toggleWorkspace: [];
  createProject: [];
}>();

const route = useRoute();
</script>

<template>
  <div v-if="mobileOpen" class="sidebar-backdrop" @click="emit('navigate')"></div>
  <aside
    class="sidebar"
    @click="emit('navigate')"
    :class="{
      'sidebar--collapsed': collapsed,
      'sidebar--mobile-open': mobileOpen,
    }"
    aria-label="Main navigation"
  >
    <RouterLink
      class="brand"
      :to="{ name: 'overview' }"
      aria-label="ORBIT home"
      @click="emit('navigate')"
    >
      <span class="brand-mark brand-mark--sidebar" aria-hidden="true">
        <img src="/images/sidebar-logo.png" alt="" />
      </span>
      <span v-if="!collapsed" class="brand-word">orbit<span>.</span></span>
    </RouterLink>

    <button
      class="workspace-switcher"
      type="button"
      :aria-label="collapsed ? 'Current workspace' : 'Switch workspace'"
      :title="collapsed ? 'Workspace' : undefined"
      :aria-expanded="workspaceOpen"
      @click.stop="emit('toggleWorkspace')"
    >
      <span class="workspace-avatar" aria-hidden="true">{{ user.workspaceName.charAt(0).toUpperCase() }}</span>
      <span v-if="!collapsed" class="workspace-copy">
        <span class="workspace-name">{{ user.workspaceName }}</span>
        <span class="workspace-plan">Your workspace</span>
      </span>
      <ChevronsUpDown v-if="!collapsed" class="workspace-chevron" :size="15" />
    </button>
    <section v-if="workspaceOpen" class="workspace-menu" aria-label="Workspace switcher">
      <p class="workspace-menu-label">YOUR WORKSPACES</p>
      <div class="workspace-menu-current">
        <span class="workspace-avatar workspace-avatar--menu" aria-hidden="true">{{
          user.workspaceName.charAt(0).toUpperCase()
        }}</span>
        <span class="workspace-copy">
          <span class="workspace-name">{{ user.workspaceName }}</span>
          <span class="workspace-plan">Your workspace</span>
        </span>
        <Check class="workspace-selected" :size="15" />
      </div>
      <RouterLink class="workspace-menu-link" :to="{ name: 'settings' }" @click="emit('navigate')">
        Workspace options
      </RouterLink>
      <p class="workspace-menu-note">More workspaces will appear here when available.</p>
    </section>

    <div v-if="!collapsed" class="nav-section-label">Workspace</div>
    <nav class="navigation-list" aria-label="Workspace">
      <RouterLink
        v-for="item in mainNavigation"
        :key="item.name"
        class="nav-link"
        :class="{ 'nav-link--active': route.name === item.name }"
        :to="{ name: item.name }"
        :title="collapsed ? item.label : undefined"
        :aria-current="route.name === item.name ? 'page' : undefined"
        @click="emit('navigate')"
      >
        <component :is="item.icon" :size="18" :stroke-width="1.8" />
        <span v-if="!collapsed">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="project-heading">
      <span v-if="!collapsed" class="nav-section-label">Your projects</span>
      <button
        class="icon-button project-add"
        type="button"
        :title="collapsed ? 'Open projects' : 'Open projects'"
        aria-label="Open projects"
        @click="emit('createProject')"
      >
        <ArrowUpRight :size="15" />
      </button>
    </div>
    <RouterLink
      class="project-empty"
      :to="{ name: 'projects' }"
      :title="collapsed ? 'No projects yet' : undefined"
      @click="emit('navigate')"
    >
      <span class="project-empty-dot"></span>
      <span v-if="!collapsed">Project views coming soon</span>
      <ChevronDown v-if="!collapsed" class="project-empty-chevron" :size="14" />
    </RouterLink>

    <div class="sidebar-spacer"></div>
    <nav class="navigation-list settings-link" aria-label="Preferences">
      <RouterLink
        v-for="item in settingsNavigation"
        :key="item.name"
        class="nav-link"
        :class="{ 'nav-link--active': route.name === item.name }"
        :to="{ name: item.name }"
        :title="collapsed ? item.label : undefined"
        @click="emit('navigate')"
      >
        <component :is="item.icon" :size="18" :stroke-width="1.8" />
        <span v-if="!collapsed">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <div class="sidebar-account">
      <span class="user-avatar user-avatar--small" aria-hidden="true">{{
        user.name.trim().charAt(0).toUpperCase()
      }}</span>
      <span v-if="!collapsed" class="account-copy">
        <span class="account-name">{{ user.name }}</span>
        <span class="account-email">{{ user.email }}</span>
      </span>
      <button
        v-if="!collapsed"
        class="icon-button account-menu-button"
        type="button"
        aria-label="Account options"
        title="Account options"
      >
        <ChevronDown :size="15" />
      </button>
    </div>
  </aside>
</template>
