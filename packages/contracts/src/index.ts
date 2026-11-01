export interface ApiSuccess<TData> {
  success: true;
  data: TData;
  message?: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export interface HealthResponse {
  status: "ok";
  service: "orbit-api";
}

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
}

export interface AuthResponse {
  user: AuthenticatedUser;
}

export type ProjectLifecycle =
  | "PLANNING"
  | "ACTIVE"
  | "ON_HOLD"
  | "COMPLETED"
  | "ARCHIVED";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  state: ProjectLifecycle;
  createdAt: string;
  updatedAt: string;
  workspace: Pick<WorkspaceSummary, "id" | "name">;
  taskCount: number;
  canManage: boolean;
  statuses: Array<{ id: string; name: string; color: string; position: number }>;
}

export interface ProjectResponse {
  project: ProjectSummary;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
}

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface TaskLabelSummary {
  id: string;
  name: string;
  color: string;
}

export interface TaskAssigneeSummary {
  id: string;
  name: string;
  email: string;
}

export interface TaskCommentSummary {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: Pick<TaskAssigneeSummary, "id" | "name">;
  canEdit: boolean;
}

export interface TaskDependencySummary {
  id: string;
  title: string;
  statusName: string;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  statusId: string;
  statusName: string;
  statusColor: string;
  priority: TaskPriority;
  assignee: TaskAssigneeSummary | null;
  reporterId: string;
  startDate: string | null;
  dueDate: string | null;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  labels: TaskLabelSummary[];
  dependencies: TaskDependencySummary[];
  commentCount: number;
}

export interface TaskDetail extends TaskSummary {
  comments: TaskCommentSummary[];
  availableDependencies: TaskDependencySummary[];
}

export interface TaskWorkspaceMember {
  id: string;
  name: string;
  email: string;
}

export interface ProjectLabelSummary extends TaskLabelSummary {
  taskCount: number;
}

export interface ProjectTasksResponse {
  tasks: TaskSummary[];
  members: TaskWorkspaceMember[];
  labels: ProjectLabelSummary[];
}

export interface MyTaskSummary extends TaskSummary {
  statusIsCompleted: boolean;
  project: {
    id: string;
    name: string;
    workspace: Pick<WorkspaceSummary, "id" | "name">;
  };
}

export interface MyTasksResponse {
  tasks: MyTaskSummary[];
}

export interface DashboardTaskSummary {
  id: string;
  projectId: string;
  title: string;
  priority: TaskPriority;
  statusName: string;
  dueDate: string | null;
  project: { id: string; name: string };
  workspace: { id: string; name: string };
}

export interface TaskFocusResponse {
  openCount: number;
  dueTodayCount: number;
  overdueCount: number;
  upcomingTasks: DashboardTaskSummary[];
}

export interface WorkspaceActivitySummary {
  id: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  project: { id: string; name: string } | null;
  createdAt: string;
}

export interface PendingWorkspaceInvitation {
  id: string;
  workspaceId: string;
  workspaceName: string;
  inviterName: string;
  role: "ADMIN" | "MEMBER";
  expiresAt: string;
}

export interface RealtimeTaskEvent {
  projectId: string;
  taskId: string | null;
  actorId: string;
  action: "created" | "updated" | "deleted" | "commented" | "labels-updated";
}

export interface PresenceUser {
  id: string;
  name: string;
}

export interface ProjectPresenceEvent {
  projectId: string;
  users: PresenceUser[];
}

export type NotificationType =
  | "TASK_ASSIGNED"
  | "TASK_MENTIONED"
  | "COMMENT_ADDED"
  | "DUE_DATE_REMINDER"
  | "PROJECT_UPDATED"
  | "INVITATION_RECEIVED";

export interface NotificationSummary {
  id: string;
  type: NotificationType;
  entityType: string;
  entityId: string;
  createdAt: string;
  readAt: string | null;
  actor: Pick<AuthenticatedUser, "id" | "name"> | null;
  task: { title: string; projectId: string; projectName: string } | null;
}

export interface NotificationsResponse {
  notifications: NotificationSummary[];
  unreadCount: number;
}

export type ProjectHealthStatus = "ON_TRACK" | "NEEDS_ATTENTION" | "AT_RISK";

export interface ProjectHealth {
  status: ProjectHealthStatus;
  reasons: string[];
  taskCount: number;
  completedTasks: number;
  completionRate: number | null;
  overdueTasks: number;
  dueSoonTasks: number;
  unassignedTasks: number;
}

export interface AnalyticsProjectSummary {
  id: string;
  name: string;
  state: ProjectLifecycle;
  health: ProjectHealth;
}

export interface AnalyticsWorkloadMember {
  memberId: string;
  name: string;
  assignedOpenTasks: number;
}

export interface AnalyticsWorkspaceResponse {
  workspace: Pick<WorkspaceSummary, "id" | "name">;
  generatedAt: string;
  summary: {
    totalProjects: number;
    activeProjects: number;
    completedProjects: number;
    totalTasks: number;
    completedTasks: number;
    completionRate: number | null;
    overdueTasks: number;
    dueSoonTasks: number;
    unassignedTasks: number;
  };
  projects: AnalyticsProjectSummary[];
  workload: AnalyticsWorkloadMember[];
  unassignedOpenTasks: number;
}

export interface AnalyticsStatusMetric {
  statusId: string;
  name: string;
  color: string;
  isComplete: boolean;
  taskCount: number;
}

export interface AnalyticsDueTask {
  id: string;
  title: string;
  dueDate: string;
  statusName: string;
  assigneeName: string | null;
}

export interface AnalyticsProjectResponse {
  workspace: Pick<WorkspaceSummary, "id" | "name">;
  project: AnalyticsProjectSummary;
  generatedAt: string;
  statuses: AnalyticsStatusMetric[];
  workload: AnalyticsWorkloadMember[];
  dueTasks: AnalyticsDueTask[];
  dueTasksLimited: boolean;
}

export interface TaskResponse {
  task: TaskDetail;
}

export interface ProjectLabelsResponse {
  labels: ProjectLabelSummary[];
}

export interface WorkspaceResponse {
  workspace: WorkspaceSummary;
}

export interface WorkspaceMemberSummary {
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  joinedAt: string;
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  inviterName: string;
  expiresAt: string;
  acceptedAt: string | null;
  expired: boolean;
}

export interface InvitationPreview {
  email: string;
  role: "ADMIN" | "MEMBER";
  workspaceName: string;
  expiresAt: string;
  accepted: boolean;
}
