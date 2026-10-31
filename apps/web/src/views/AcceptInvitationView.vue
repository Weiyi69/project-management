<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ArrowRight, Check, LoaderCircle, MailCheck, Sparkles } from "@lucide/vue";
import { useAuthStore } from "../stores/auth";
import { WorkspaceApiError, workspaceApi } from "../lib/workspace-api";
import { useWorkspaceStore } from "../stores/workspaces";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const workspaces = useWorkspaceStore();
const loading = ref(true);
const accepting = ref(false);
const error = ref("");
const notice = ref("");
const invitation = ref<Awaited<ReturnType<typeof workspaceApi.previewInvitation>> | null>(null);
const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const returnUrl = computed(() => route.fullPath);

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    if (!token.value) throw new Error("Invitation link is missing its invitation token.");
    invitation.value = await workspaceApi.previewInvitation(token.value);
  } catch (caught) {
    error.value =
      caught instanceof Error ? caught.message : "Could not load this invitation.";
  } finally {
    loading.value = false;
  }
}

async function accept(): Promise<void> {
  accepting.value = true;
  error.value = "";
  try {
    const workspace = await workspaceApi.acceptInvitation(token.value);
    await workspaces.load(workspace.id, true);
    notice.value = `You joined ${workspace.name}.`;
    await router.replace({ name: "projects" });
  } catch (caught) {
    error.value =
      caught instanceof WorkspaceApiError && caught.status === 403
        ? `Sign in with ${invitation.value?.email} to accept this invitation.`
        : caught instanceof Error
          ? caught.message
          : "Could not accept this invitation.";
  } finally {
    accepting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <main class="auth-page">
    <section class="auth-story">
      <RouterLink class="brand auth-brand" :to="{ name: 'overview' }" aria-label="ORBIT home">
        <span class="brand-mark brand-mark--auth" aria-hidden="true">
          <img src="/images/authentication-logo.png" alt="" />
        </span>
        <span class="brand-word">orbit<span>.</span></span>
      </RouterLink>
      <div class="auth-story-copy">
        <p class="auth-eyebrow"><span></span> Better work, together</p>
        <h1>Good work<br />starts together.</h1>
        <p>Join your team and make room for what matters.</p>
      </div>
      <div class="auth-story-foot">
        <span class="auth-story-orbit" aria-hidden="true">
          <img src="/images/authentication-logo.png" alt="" />
        </span>
        <span>Clarity for the work that moves you.</span>
      </div>
    </section>
    <section class="auth-form-side">
      <div class="auth-form-wrap invitation-accept-card">
        <RouterLink class="auth-back-link" :to="{ name: 'login' }">
          <ArrowRight :size="15" class="invitation-back-icon" /> Back to sign in
        </RouterLink>
        <div class="auth-form-heading">
          <p class="eyebrow">WORKSPACE INVITATION</p>
          <h2>Join your workspace</h2>
          <p>Accept this invitation to start collaborating.</p>
        </div>

        <div v-if="loading" class="project-loading" role="status">
          <LoaderCircle class="project-spinner" :size="20" /> Loading invitation…
        </div>
        <div v-else-if="invitation" class="invitation-details">
          <span class="project-create-icon"><MailCheck :size="19" /></span>
          <strong>{{ invitation.workspaceName }}</strong>
          <span>Invited as {{ invitation.role.toLowerCase() }}</span>
          <span>{{ invitation.email }}</span>
          <span>Expires {{ new Date(invitation.expiresAt).toLocaleDateString() }}</span>
        </div>

        <p v-if="error" class="auth-notice" role="alert">{{ error }}</p>
        <p v-if="notice" class="project-saved" role="status"><Check :size="15" /> {{ notice }}</p>

        <template v-if="invitation && !loading">
          <button
            v-if="auth.user && !invitation.accepted"
            class="button button--primary auth-submit"
            type="button"
            :disabled="accepting"
            @click="accept"
          >
            <LoaderCircle v-if="accepting" class="project-spinner" :size="15" />
            {{ accepting ? "Joining..." : "Accept invitation" }}
            <ArrowRight v-if="!accepting" :size="15" />
          </button>
          <p v-else-if="invitation.accepted" class="project-saved" role="status">
            <Check :size="15" /> This invitation has already been accepted.
          </p>
          <div v-else class="invitation-auth-actions">
            <RouterLink
              class="button button--primary auth-submit"
              :to="{ name: 'login', query: { redirect: returnUrl } }"
            >
              Sign in to accept <ArrowRight :size="15" />
            </RouterLink>
            <RouterLink
              class="button button--quiet auth-submit"
              :to="{
                name: 'register',
                query: { email: invitation.email, redirect: returnUrl },
              }"
            >
              Create an account <Sparkles :size="15" />
            </RouterLink>
          </div>
        </template>
        <p class="auth-disclaimer">
          <span class="auth-disclaimer-dot"></span>
          To protect your workspace, only the invited email address can accept this invitation.
        </p>
      </div>
      <span class="auth-bottom-note">ORBIT — a calmer way to get there.</span>
    </section>
  </main>
</template>
