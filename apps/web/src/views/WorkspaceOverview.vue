<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { ArrowRight, ArrowUpRight, FolderPlus, Sparkles, UsersRound } from "@lucide/vue";

const now = new Date();
const greeting = computed(() => {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
});
const dateLabel = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(now);
</script>

<template>
  <div class="overview-page">
    <section class="page-heading">
      <div>
        <p class="eyebrow">{{ dateLabel }}</p>
        <h1>{{ greeting }}<span class="heading-period">.</span></h1>
        <p class="page-subtitle">A little space to do great work.</p>
      </div>
      <RouterLink class="button button--primary" :to="{ name: 'projects' }">
        <FolderPlus :size="16" /> Explore projects
      </RouterLink>
    </section>

    <section class="welcome-panel">
      <div class="welcome-content">
        <span class="welcome-kicker"><Sparkles :size="14" /> YOUR WORKSPACE</span>
        <h2>Everything starts<br />with a good idea.</h2>
        <p>
          Bring your team and your work together. Start with a project, then build your momentum one
          task at a time.
        </p>
        <div class="welcome-actions">
          <RouterLink class="button button--white" :to="{ name: 'projects' }">
            Explore projects <ArrowRight :size="15" />
          </RouterLink>
          <span class="text-button text-button--light text-button--static">
            <UsersRound :size="16" /> Invitations in a later stage
          </span>
        </div>
      </div>
      <div class="welcome-orbit" aria-hidden="true">
        <span class="orbit-ring orbit-ring--outer"></span>
        <span class="orbit-ring orbit-ring--middle"></span>
        <span class="orbit-ring orbit-ring--inner"></span>
        <span class="orbit-core"><Sparkles :size="24" /></span>
        <span class="orbit-satellite orbit-satellite--one"></span>
        <span class="orbit-satellite orbit-satellite--two"></span>
        <span class="orbit-satellite orbit-satellite--three"></span>
      </div>
    </section>

    <section class="overview-columns">
      <article class="surface-panel activity-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">YOUR WORKSPACE</p>
            <h2>Recent activity</h2>
          </div>
          <span class="panel-heading-note">Preview</span>
        </div>
        <div class="empty-activity">
          <span class="empty-activity-icon"><Sparkles :size="18" /></span>
          <h3>A fresh start</h3>
          <p>When your team gets moving, important updates will appear here.</p>
          <RouterLink class="subtle-link" :to="{ name: 'projects' }">
            Explore projects <ArrowUpRight :size="14" />
          </RouterLink>
        </div>
      </article>

      <article class="surface-panel projects-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">MAKE IT HAPPEN</p>
            <h2>Your projects</h2>
          </div>
          <RouterLink class="icon-button panel-action" :to="{ name: 'projects' }" aria-label="View projects">
            <ArrowUpRight :size="17" />
          </RouterLink>
        </div>
        <RouterLink class="create-project-card" :to="{ name: 'projects' }">
          <span class="create-project-icon"><FolderPlus :size="18" /></span>
          <span class="create-project-copy">
            <strong>Manage your workspace projects</strong>
            <span>Create projects, track their status, and keep the details current.</span>
          </span>
          <ArrowRight class="create-project-arrow" :size="16" />
        </RouterLink>
        <p class="honest-data-note">Project details are saved to your local workspace.</p>
      </article>
    </section>
  </div>
</template>
