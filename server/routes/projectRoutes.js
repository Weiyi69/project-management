import { Router } from "express";

import {
  addProjectMemberController,
  createProjectController,
  updateProjectController,
} from "../controllers/projectController.js";

const router = Router();

router.post("/create", createProjectController);
router.put("/update", updateProjectController);
router.post("/add-member", addProjectMemberController);

export default router;
