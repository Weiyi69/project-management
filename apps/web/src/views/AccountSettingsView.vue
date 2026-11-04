<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import type {
  AccountProfile,
  NotificationPreference,
  NotificationPreferenceType,
} from "@orbit/contracts";
import { accountApi, accountPhotoUrl, type AccountSession } from "../lib/account-api";
import { useAuthStore } from "../stores/auth";

type SettingsSection = "profile" | "notifications" | "security";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const section = computed<SettingsSection>(() => {
  if (route.name === "account-notifications") return "notifications";
  if (route.name === "account-security") return "security";
  return "profile";
});
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const profile = ref<AccountProfile | null>(null);
const displayName = ref("");
const newEmail = ref("");
const emailCode = ref("");
const emailCodeRequested = ref(false);
const photoRevision = ref(0);
const preferences = ref<NotificationPreference[]>([]);
const currentPassword = ref("");
const newPassword = ref("");
const sessions = ref<AccountSession[]>([]);

const tabs = [
  { section: "profile", label: "Profile", route: "account-profile" },
  { section: "notifications", label: "Notifications", route: "account-notifications" },
  { section: "security", label: "Security", route: "account-security" },
] as const;

const preferenceLabels: Record<NotificationPreferenceType, string> = {
  TASK_ASSIGNED: "Task assignments",
  TASK_MENTIONED: "Mentions",
  COMMENT_ADDED: "Comments and replies",
  DUE_DATE_REMINDER: "Due-date reminders",
  PROJECT_UPDATED: "Project updates",
  INVITATION_RECEIVED: "Workspace invitations",
};

const photoUrl = computed(() => `${accountPhotoUrl}?v=${photoRevision.value}`);

function notificationLabel(type: NotificationPreferenceType): string {
  return preferenceLabels[type];
}

function readableDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  notice.value = "";
  try {
    if (section.value === "profile") {
      profile.value = await accountApi.profile();
      displayName.value = profile.value.name;
      emailCodeRequested.value = profile.value.pendingEmail !== null;
    } else if (section.value === "notifications") {
      preferences.value = (await accountApi.notificationPreferences()).preferences;
    } else {
      sessions.value = await accountApi.sessions();
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not load account settings.";
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());
watch(() => route.name, () => void load());

async function saveProfile(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const updated = await accountApi.updateProfile(displayName.value.trim());
    displayName.value = updated.name;
    await auth.refreshCurrentUser();
    notice.value = "Your display name was updated.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not update your profile.";
  } finally {
    saving.value = false;
  }
}

async function uploadPhoto(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = "";
  error.value = "";
  notice.value = "";
  if (file.size > 5 * 1024 * 1024) {
    error.value = "Profile photos must be 5 MB or smaller.";
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    error.value = "Choose a JPEG, PNG, or WebP image.";
    return;
  }
  saving.value = true;
  try {
    await accountApi.uploadProfilePhoto(file);
    if (profile.value) profile.value.hasProfilePhoto = true;
    photoRevision.value += 1;
    notice.value = "Your profile photo was saved.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not upload your profile photo.";
  } finally {
    saving.value = false;
  }
}

async function removePhoto(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await accountApi.removeProfilePhoto();
    if (profile.value) profile.value.hasProfilePhoto = false;
    photoRevision.value += 1;
    notice.value = "Your profile photo was removed.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not remove your profile photo.";
  } finally {
    saving.value = false;
  }
}

async function requestEmailChange(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await accountApi.requestEmailChange(newEmail.value.trim());
    profile.value = await accountApi.profile();
    emailCodeRequested.value = true;
    emailCode.value = "";
    notice.value = `A verification code was sent to ${profile.value.pendingEmail}.`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not request an email change.";
  } finally {
    saving.value = false;
  }
}

async function confirmEmailChange(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await accountApi.confirmEmailChange(emailCode.value);
    profile.value = await accountApi.profile();
    newEmail.value = "";
    emailCode.value = "";
    emailCodeRequested.value = false;
    await auth.refreshCurrentUser();
    notice.value = "Your verified email address was updated.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not verify the new email address.";
  } finally {
    saving.value = false;
  }
}

async function cancelEmailChange(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await accountApi.cancelEmailChange();
    profile.value = await accountApi.profile();
    newEmail.value = "";
    emailCode.value = "";
    emailCodeRequested.value = false;
    notice.value = "The pending email change was cancelled.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not cancel the email change.";
  } finally {
    saving.value = false;
  }
}

async function savePreferences(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    preferences.value = (await accountApi.saveNotificationPreferences(preferences.value)).preferences;
    notice.value = "Your notification preferences were saved.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not save notification preferences.";
  } finally {
    saving.value = false;
  }
}

async function savePassword(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await accountApi.changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = "";
    newPassword.value = "";
    sessions.value = await accountApi.sessions();
    notice.value = "Your password was changed. Other active sessions were signed out.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not change your password.";
  } finally {
    saving.value = false;
  }
}

async function revokeSession(session: AccountSession): Promise<void> {
  if (
    session.current &&
    !window.confirm("Sign out of this browser session? You will need to sign in again.")
  ) {
    return;
  }
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await accountApi.revokeSession(session.id);
    if (session.current) {
      auth.expireSession();
      await router.replace({ name: "login" });
      return;
    }
    sessions.value = sessions.value.filter(({ id }) => id !== session.id);
    notice.value = "The selected session was revoked.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not revoke the session.";
  } finally {
    saving.value = false;
  }
}

async function revokeOtherSessions(): Promise<void> {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await accountApi.revokeOtherSessions();
    sessions.value = await accountApi.sessions();
    notice.value = "All other active sessions were revoked.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Could not revoke other sessions.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="account-settings-page">
    <header class="account-settings-heading">
      <div>
        <p class="eyebrow">PERSONAL ACCOUNT</p>
        <h1>Account settings</h1>
        <p>Manage your profile, notification preferences, and sign-in security.</p>
      </div>
      <RouterLink class="button button--quiet" :to="{ name: 'settings' }">
        Workspace settings
      </RouterLink>
    </header>

    <nav class="account-settings-tabs" aria-label="Personal account settings">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.section"
        :to="{ name: tab.route }"
        :aria-current="section === tab.section ? 'page' : undefined"
        class="account-settings-tab"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>

    <p v-if="error" class="project-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="project-saved" role="status" aria-live="polite">{{ notice }}</p>
    <div v-if="loading" class="project-loading" role="status">Loading personal settings…</div>

    <template v-else-if="section === 'profile' && profile">
      <section class="project-create-panel account-settings-panel" aria-labelledby="account-profile-title">
        <div class="account-profile-photo-row">
          <div
            class="account-profile-photo"
            role="img"
            :aria-label="profile.hasProfilePhoto ? 'Profile photo' : `Profile initials for ${profile.name}`"
          >
            <img v-if="profile.hasProfilePhoto" :src="photoUrl" alt="" />
            <span v-else aria-hidden="true">{{ profile.name.trim().charAt(0).toUpperCase() }}</span>
          </div>
          <div class="account-photo-actions">
            <h2 id="account-profile-title">Profile</h2>
            <p>JPEG, PNG, or WebP. Maximum file size is 5 MB. Images are resized to 512 × 512 and stored securely.</p>
            <div class="account-action-row">
              <label class="button button--quiet account-upload-button">
                Upload photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Upload profile photo"
                  :disabled="saving"
                  @change="uploadPhoto"
                />
              </label>
              <button
                v-if="profile.hasProfilePhoto"
                class="button button--quiet"
                type="button"
                :disabled="saving"
                @click="removePhoto"
              >
                Remove photo
              </button>
            </div>
          </div>
        </div>

        <form class="account-settings-form" @submit.prevent="saveProfile">
          <label class="project-field">
            <span>Display name</span>
            <input
              v-model="displayName"
              name="displayName"
              autocomplete="name"
              minlength="2"
              maxlength="80"
              required
            />
          </label>
          <button class="button button--primary" type="submit" :disabled="saving">
            Save profile
          </button>
        </form>

        <div class="account-readonly-row">
          <div>
            <strong>Email address</strong>
            <span>{{ profile.email }}</span>
          </div>
          <span
            class="account-verification-badge"
            :class="{ 'account-verification-badge--verified': profile.emailVerifiedAt }"
          >
            {{ profile.emailVerifiedAt ? "Verified" : "Not verified" }}
          </span>
        </div>
        <div class="account-readonly-row">
          <div>
            <strong>Account created</strong>
            <span>{{ new Date(profile.createdAt).toLocaleDateString() }}</span>
          </div>
        </div>
      </section>

      <section class="project-create-panel account-settings-panel">
        <div class="account-panel-heading">
          <div>
            <h2>Change email address</h2>
            <p>Your current email remains active until you verify the new address.</p>
          </div>
        </div>
        <form class="account-settings-form" @submit.prevent="requestEmailChange">
          <label class="project-field">
            <span>New email address</span>
            <input
              v-model="newEmail"
              type="email"
              name="newEmail"
              autocomplete="email"
              maxlength="254"
              required
              :disabled="saving"
            />
          </label>
          <button class="button button--quiet" type="submit" :disabled="saving">
            Send verification code
          </button>
        </form>
        <form
          v-if="emailCodeRequested && profile.pendingEmail"
          class="account-settings-form account-email-confirm"
          @submit.prevent="confirmEmailChange"
        >
          <p class="account-pending-email">Verification sent to <strong>{{ profile.pendingEmail }}</strong>.</p>
          <label class="project-field">
            <span>Six-digit verification code</span>
            <input
              v-model="emailCode"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              maxlength="6"
              required
            />
          </label>
          <div class="account-action-row">
            <button class="button button--primary" type="submit" :disabled="saving">
              Verify and update email
            </button>
            <button class="button button--quiet" type="button" :disabled="saving" @click="cancelEmailChange">
              Cancel change
            </button>
          </div>
        </form>
      </section>
    </template>

    <section
      v-else-if="section === 'notifications'"
      class="project-create-panel account-settings-panel"
      aria-labelledby="account-notification-title"
    >
      <div class="account-panel-heading">
        <div>
          <h2 id="account-notification-title">Notification preferences</h2>
          <p>Email notifications are sent only to your verified email address. Security and account emails are not controlled here.</p>
        </div>
      </div>
      <div class="account-preferences-table">
        <div class="account-preferences-header" aria-hidden="true">
          <span>Activity</span><span>In-app</span><span>Email</span>
        </div>
        <div v-for="preference in preferences" :key="preference.type" class="account-preference-row">
          <strong>{{ notificationLabel(preference.type) }}</strong>
          <label class="account-switch">
            <span class="sr-only">{{ notificationLabel(preference.type) }} in-app notifications</span>
            <input v-model="preference.inApp" type="checkbox" />
            <span aria-hidden="true"></span>
          </label>
          <label class="account-switch">
            <span class="sr-only">{{ notificationLabel(preference.type) }} email notifications</span>
            <input v-model="preference.email" type="checkbox" />
            <span aria-hidden="true"></span>
          </label>
        </div>
      </div>
      <button class="button button--primary account-save-preferences" type="button" :disabled="saving" @click="savePreferences">
        Save preferences
      </button>
    </section>

    <template v-else-if="section === 'security'">
      <section class="project-create-panel account-settings-panel">
        <div class="account-panel-heading">
          <div>
            <h2>Change password</h2>
            <p>Enter your current password to confirm this change. Other active sessions will be signed out.</p>
          </div>
        </div>
        <form class="account-settings-form account-password-form" @submit.prevent="savePassword">
          <label class="project-field">
            <span>Current password</span>
            <input v-model="currentPassword" type="password" autocomplete="current-password" maxlength="128" required />
          </label>
          <label class="project-field">
            <span>New password</span>
            <input
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              minlength="12"
              maxlength="128"
              required
            />
            <small>Use at least 12 characters.</small>
          </label>
          <button class="button button--primary" type="submit" :disabled="saving">Update password</button>
        </form>
      </section>

      <section class="project-create-panel account-settings-panel">
        <div class="account-panel-heading account-sessions-heading">
          <div>
            <h2>Active sessions</h2>
            <p>Only session dates and this browser marker are shown. Session credentials are never exposed.</p>
          </div>
          <button
            v-if="sessions.some((session) => !session.current)"
            class="button button--quiet"
            type="button"
            :disabled="saving"
            @click="revokeOtherSessions"
          >
            Sign out other sessions
          </button>
        </div>
        <ul v-if="sessions.length" class="account-session-list">
          <li v-for="session in sessions" :key="session.id" class="account-session-row">
            <div>
              <strong>{{ session.current ? "This browser" : "Other session" }}</strong>
              <span>Started {{ readableDate(session.createdAt) }} · Expires {{ readableDate(session.expiresAt) }}</span>
            </div>
            <button
              class="button button--quiet"
              type="button"
              :disabled="saving"
              :aria-label="`${session.current ? 'Sign out of this browser' : 'Revoke other'} session started ${readableDate(session.createdAt)}`"
              @click="revokeSession(session)"
            >
              {{ session.current ? "Sign out" : "Revoke" }}
            </button>
          </li>
        </ul>
        <p v-else class="account-muted-note">No active sessions were found.</p>
      </section>
    </template>
  </div>
</template>
