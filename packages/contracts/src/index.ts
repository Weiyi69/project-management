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
  workspaceName: string;
}

export interface AuthResponse {
  user: AuthenticatedUser;
}
