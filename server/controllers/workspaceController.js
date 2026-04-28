import {
  createWorkspace,
  deleteWorkspace,
  getWorkspacesForUser,
  updateWorkspace,
} from "../services/workspaceService.js";

const getAuthUserId = async (req) => {
  const auth = typeof req.auth === "function" ? await req.auth() : req.auth;
  return auth?.userId;
};

export const getWorkspacesController = async (req, res, next) => {
  try {
    const userId = await getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const workspaces = await getWorkspacesForUser(userId);
    res.json(workspaces);
  } catch (error) {
    next(error);
  }
};

export const createWorkspaceController = async (req, res, next) => {
  try {
    const userId = await getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const workspace = await createWorkspace({
      userId,
      actor: req.body.actor,
      ...req.body,
    });
    res.status(201).json(workspace);
  } catch (error) {
    next(error);
  }
};

export const updateWorkspaceController = async (req, res, next) => {
  try {
    const userId = await getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const workspace = await updateWorkspace({
      userId,
      ...req.body,
    });
    res.json(workspace);
  } catch (error) {
    next(error);
  }
};

export const deleteWorkspaceController = async (req, res, next) => {
  try {
    const userId = await getAuthUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await deleteWorkspace({
      userId,
      workspaceId: req.body.workspaceId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
};
