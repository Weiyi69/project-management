<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "@lucide/vue";
import { AuthApiError, authApi } from "../lib/auth-api";
import { useAuthStore } from "../stores/auth";

type AuthMode = "login" | "register" | "verify-email" | "forgot-password" | "reset-password";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const mode = computed(() => route.name as AuthMode);
const fullName = ref("");
const email = ref("");
const password = ref("");
const code = ref("");
const showPassword = ref(false);
const message = ref("");
const submitting = ref(false);
const unverifiedAccount = ref(false);
const resendCooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | undefined;

const redirectTarget = computed(() => {
  const redirect = route.query.redirect;
  return typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//")
    ? redirect
    : undefined;
});

const visibleMessage = computed(
  () =>
    message.value ||
    auth.error ||
    (route.query.verified === "true"
      ? "Email verified successfully. You can now sign in."
      : route.query.reset === "true"
        ? "Your password was reset. Sign in with your new password."
        : route.query.registered === "true"
          ? "If this email needs verification, check your inbox or request another code after the cooldown. If it is already verified, return to sign in."
        : route.query.reason === "api-unavailable"
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
  if (mode.value === "verify-email") {
    return {
      eyebrow: "One last step",
      title: "Check your\ninbox.",
      subtitle: "Enter the six-digit code if your email needs verification. Already verified? Return to sign in.",
      heading: "Verify your email",
      button: "Verify email",
    };
  }
  if (mode.value === "forgot-password") {
    return {
      eyebrow: "Account recovery",
      title: "Let’s get you\nback on track.",
      subtitle: "We’ll email a reset code if an account matches that address.",
      heading: "Reset your password",
      button: "Send reset code",
    };
  }
  if (mode.value === "reset-password") {
    return {
      eyebrow: "Account recovery",
      title: "A fresh start,\nright here.",
      subtitle: "Enter the code from your email and choose a new password.",
      heading: "Choose a new password",
      button: "Reset password",
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

function startCooldown(seconds: number): void {
  resendCooldown.value = Math.max(0, Math.ceil(seconds));
  if (cooldownTimer) clearInterval(cooldownTimer);
  if (resendCooldown.value === 0) return;
  cooldownTimer = setInterval(() => {
    resendCooldown.value = Math.max(0, resendCooldown.value - 1);
    if (resendCooldown.value === 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = undefined;
    }
  }, 1000);
}

watch(
  () => route.name,
  () => {
    message.value = "";
    password.value = "";
    code.value = "";
    unverifiedAccount.value = false;
    auth.clearError();
  },
);

watch(
  () => route.query.email,
  (queryEmail) => {
    if (typeof queryEmail === "string") email.value = queryEmail;
  },
  { immediate: true },
);

async function submitAuthForm(): Promise<void> {
  submitting.value = true;
  message.value = "";
  unverifiedAccount.value = false;
  auth.clearError();

  try {
    if (mode.value === "register") {
      const result = await auth.register({
        name: fullName.value,
        email: email.value,
        password: password.value,
      });
      await router.push({
        name: "verify-email",
        query: {
          email: result.email,
          ...(redirectTarget.value ? { redirect: redirectTarget.value } : {}),
          cooldown: String(result.resendCooldownSeconds),
          registered: "true",
        },
      });
      startCooldown(result.resendCooldownSeconds);
      return;
    }

    if (mode.value === "verify-email") {
      await authApi.verifyEmail({ email: email.value, code: code.value });
      await router.replace({
        name: "login",
        query: {
          verified: "true",
          ...(redirectTarget.value ? { redirect: redirectTarget.value } : {}),
        },
      });
      return;
    }

    if (mode.value === "forgot-password") {
      await authApi.requestPasswordReset(email.value);
      await router.push({
        name: "reset-password",
        query: {
          email: email.value.trim().toLowerCase(),
          ...(redirectTarget.value ? { redirect: redirectTarget.value } : {}),
        },
      });
      message.value = "If an account exists for that email, a reset code has been sent.";
      return;
    }

    if (mode.value === "reset-password") {
      await authApi.resetPassword({
        email: email.value,
        code: code.value,
        newPassword: password.value,
      });
      await router.replace({
        name: "login",
        query: {
          reset: "true",
          ...(redirectTarget.value ? { redirect: redirectTarget.value } : {}),
        },
      });
      return;
    }

    await auth.login({ email: email.value, password: password.value });
    await router.push(redirectTarget.value ?? { name: "overview" });
  } catch (caught) {
    if (mode.value === "login" && caught instanceof AuthApiError && caught.status === 403) {
      unverifiedAccount.value = true;
    }
    message.value = auth.error || (caught instanceof Error ? caught.message : "Please try again.");
  } finally {
    submitting.value = false;
  }
}

async function resendVerification(): Promise<void> {
  submitting.value = true;
  message.value = "";
  try {
    const result = await authApi.resendVerification(email.value);
    startCooldown(result.resendCooldownSeconds);
    message.value = "If your account needs verification, a code has been sent.";
  } catch (caught) {
    message.value = caught instanceof Error ? caught.message : "Could not request another code.";
  } finally {
    submitting.value = false;
  }
}

watch(
  () => [route.name, route.query.cooldown] as const,
  ([name, cooldown]) => {
    if (name === "verify-email" && typeof cooldown === "string") {
      startCooldown(Number(cooldown));
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});
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
            New to ORBIT? <RouterLink :to="{ name: 'register', query: redirectTarget ? { redirect: redirectTarget } : {} }">Create an account</RouterLink>
          </p>
          <p v-else-if="mode === 'register'">
            Already have an account? <RouterLink :to="{ name: 'login', query: redirectTarget ? { redirect: redirectTarget } : {} }">Sign in</RouterLink>
          </p>
          <p v-else-if="mode === 'verify-email'">
            We sent a code to <strong>{{ email }}</strong>.
          </p>
          <p v-else-if="mode === 'reset-password'">
            Enter the code sent to <strong>{{ email }}</strong>.
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

          <label v-if="mode === 'verify-email' || mode === 'reset-password'" class="form-field">
            <span>{{ mode === "verify-email" ? "Verification code" : "Password reset code" }}</span>
            <input
              v-model="code"
              name="code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              minlength="6"
              maxlength="6"
              aria-describedby="auth-code-hint"
              required
            />
            <span id="auth-code-hint">Enter the six-digit code from your email.</span>
          </label>

          <div v-if="mode === 'login' || mode === 'register' || mode === 'reset-password'" class="form-field">
            <span class="field-label-row">
              <label for="auth-password">{{ mode === "reset-password" ? "New password" : "Password" }}</label>
              <RouterLink
                v-if="mode === 'login'"
                class="field-side-link"
                :to="{ name: 'forgot-password', query: redirectTarget ? { redirect: redirectTarget } : {} }"
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
                :placeholder="mode === 'login' ? 'Enter your password' : 'At least 12 characters'"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                :minlength="mode === 'login' ? undefined : 12"
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

          <p v-if="visibleMessage" class="auth-notice" role="status">{{ visibleMessage }}</p>
          <RouterLink
            v-if="unverifiedAccount"
            class="field-side-link"
            :to="{
              name: 'verify-email',
              query: { email, ...(redirectTarget ? { redirect: redirectTarget } : {}) },
            }"
          >
            Verify your email or request a new code
          </RouterLink>

          <button
            class="button button--primary auth-submit"
            type="submit"
            :disabled="submitting"
            :aria-busy="submitting"
          >
            {{ submitting ? "Please wait..." : copy.button }}
            <ArrowRight :size="16" />
          </button>
        </form>

        <button
          v-if="mode === 'verify-email'"
          class="auth-return-link auth-resend-button"
          type="button"
          :disabled="submitting || resendCooldown > 0"
          @click="resendVerification"
        >
          {{
            resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : "Resend verification code"
          }}
        </button>
        <RouterLink
          v-if="mode === 'verify-email' || mode === 'reset-password'"
          class="auth-return-link"
          :to="{ name: 'login', query: redirectTarget ? { redirect: redirectTarget } : {} }"
        >
          Return to sign in
        </RouterLink>
        <RouterLink
          v-if="mode === 'forgot-password'"
          class="auth-return-link"
          :to="{ name: 'login', query: redirectTarget ? { redirect: redirectTarget } : {} }"
        >
          Return to sign in
        </RouterLink>

        <p class="auth-disclaimer">
          <span class="auth-disclaimer-dot"></span>
          Passwords are protected with Argon2id. Your browser session uses an HTTP-only cookie.
        </p>
      </div>
      <span class="auth-bottom-note">ORBIT — a calmer way to get there.</span>
    </section>
  </main>
</template>
