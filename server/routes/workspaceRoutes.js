import { Router } from "express";

import {
  createWorkspaceController,
  deleteWorkspaceController,
  getWorkspacesController,
  updateWorkspaceController,
} from "../controllers/workspaceController.js";

const router = Router();

router.get("/", getWorkspacesController);
router.post("/create", createWorkspaceController);
router.post("/update", updateWorkspaceController);
router.delete("/delete", deleteWorkspaceController);

export default router;
