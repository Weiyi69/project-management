<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "@lucide/vue";
import { useAuthStore } from "../stores/auth";

type AuthMode = "login" | "register" | "forgot-password";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const mode = computed(() => route.name as AuthMode);
const fullName = ref("");
const email = ref("");
const password = ref("");
const showPassword = ref(false);
const message = ref("");
const submitting = ref(false);
const visibleMessage = computed(
  () =>
    message.value ||
    auth.error ||
    (route.query.reason === "api-unavailable"
      ? "Could not connect to the API. Start the API server, then try again."
      : ""),
);

const copy = computed(() => {
  if (mode.value === "register") {
    return {
      eyebrow: "A better way to work together",
      title: "Make room for\nwhat matters.",
      subtitle: "Bring your team, projects, and ideas into one calm, focused place.",
      heading: "Create your account",
      button: "Create account",
    };
  }
  if (mode.value === "forgot-password") {
    return {
      eyebrow: "Account recovery",
      title: "Let’s get you\nback on track.",
      subtitle: "Password recovery will be available once ORBIT email delivery is configured.",
      heading: "Password reset unavailable",
      button: "Password reset unavailable",
    };
  }
  return {
    eyebrow: "Your work, in orbit",
    title: "Find your flow.\nMove things forward.",
    subtitle: "A clear space for focused teams to make meaningful progress together.",
    heading: "Welcome back",
    button: "Sign in",
  };
});

watch(
  () => route.name,
  () => {
    message.value = "";
    password.value = "";
    auth.clearError();
  },
);

watch(
  () => route.query.email,
  (invitedEmail) => {
    if (mode.value === "register" && typeof invitedEmail === "string") {
      email.value = invitedEmail;
    }
  },
  { immediate: true },
);

async function submitAuthForm(): Promise<void> {
  if (mode.value === "forgot-password") {
    message.value =
      "Password reset is unavailable until email delivery is configured. No reset email was sent.";
    return;
  }

  submitting.value = true;
  message.value = "";
  auth.clearError();

  try {
    if (mode.value === "register") {
      await auth.register({ name: fullName.value, email: email.value, password: password.value });
    } else {
      await auth.login({ email: email.value, password: password.value });
    }

    const redirect = route.query.redirect;
    const destination =
      typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//")
        ? redirect
        : { name: "overview" };
    await router.push(destination);
  } catch {
    message.value = auth.error || "Authentication failed. Please try again.";
  } finally {
    submitting.value = false;
  }
}
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
        <p class="auth-eyebrow"><span></span>{{ copy.eyebrow }}</p>
        <h1>{{ copy.title }}</h1>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="auth-story-foot">
        <span class="auth-story-orbit" aria-hidden="true">
          <img src="/images/authentication-logo.png" alt="" />
        </span>
        <span>Clarity for the work that moves you.</span>
      </div>
    </section>

    <section class="auth-form-side">
      <div class="auth-form-wrap">
        <RouterLink class="auth-back-link" :to="{ name: 'overview' }">
          <ArrowLeft :size="15" /> Back to ORBIT
        </RouterLink>

        <div class="auth-form-heading">
          <p class="eyebrow">{{ mode === "register" ? "GET STARTED" : "YOUR WORKSPACE" }}</p>
          <h2>{{ copy.heading }}</h2>
          <p v-if="mode === 'login'">
            New to ORBIT? <RouterLink :to="{ name: 'register' }">Create an account</RouterLink>
          </p>
          <p v-else-if="mode === 'register'">
            Already have an account? <RouterLink :to="{ name: 'login' }">Sign in</RouterLink>
          </p>
          <p v-else>We’ll help you find your way back.</p>
        </div>

        <form class="auth-form" @submit.prevent="submitAuthForm">
          <label v-if="mode === 'register'" class="form-field">
            <span>Your name</span>
            <input
              v-model="fullName"
              name="name"
              type="text"
              placeholder="e.g. Alex Morgan"
              autocomplete="name"
              maxlength="80"
              required
            />
          </label>
          <label class="form-field">
            <span>Email address</span>
            <input
              v-model="email"
              name="email"
              type="email"
              placeholder="you@company.com"
              autocomplete="email"
              maxlength="254"
              required
            />
          </label>
          <div v-if="mode !== 'forgot-password'" class="form-field">
            <span class="field-label-row">
              <label for="auth-password">Password</label>
              <RouterLink
                v-if="mode === 'login'"
                class="field-side-link"
                :to="{ name: 'forgot-password' }"
              >
                Forgot password?
              </RouterLink>
            </span>
            <span class="password-input-wrap">
              <input
                v-model="password"
                id="auth-password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="mode === 'register' ? 'At least 12 characters' : 'Enter your password'"
                :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
                :minlength="mode === 'register' ? 12 : undefined"
                maxlength="128"
                required
              />
              <button
                class="password-visibility"
                type="button"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="showPassword = !showPassword"
              >
                <EyeOff v-if="showPassword" :size="17" />
                <Eye v-else :size="17" />
              </button>
            </span>
          </div>

          <p
            v-if="mode === 'forgot-password'"
            class="auth-notice"
            role="status"
          >
            Password reset is unavailable until email delivery is configured. No reset email will
            be sent.
          </p>
          <p v-else-if="visibleMessage" class="auth-notice" role="alert">{{ visibleMessage }}</p>

          <button
            class="button button--primary auth-submit"
            type="submit"
            :disabled="submitting || mode === 'forgot-password'"
            :aria-busy="submitting"
          >
            {{
              submitting
                ? mode === "register"
                  ? "Creating account..."
                  : "Signing in..."
                : mode === "forgot-password"
                  ? "Password reset unavailable"
                  : copy.button
            }}
            <ArrowRight v-if="mode !== 'forgot-password'" :size="16" />
          </button>
        </form>

        <p class="auth-disclaimer" v-if="mode !== 'forgot-password'">
          <span class="auth-disclaimer-dot"></span>
          Passwords are protected with Argon2id. Your browser session uses an HTTP-only cookie.
        </p>
        <p class="auth-disclaimer" v-else>
          <span class="auth-disclaimer-dot"></span>
          Password reset is not available until email delivery has been configured.
        </p>
        <RouterLink
          v-if="mode === 'forgot-password'"
          class="auth-return-link"
          :to="{ name: 'login' }"
        >
          Return to sign in
        </RouterLink>
      </div>
      <span class="auth-bottom-note">ORBIT — a calmer way to get there.</span>
    </section>
  </main>
</template>
