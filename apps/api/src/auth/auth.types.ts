import type { Request } from "express";
import type { AuthenticatedUser } from "@orbit/contracts";

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
