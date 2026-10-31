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
  role: "ADMIN" | "MEMBER" | "OWNER";
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
