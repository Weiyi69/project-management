import { Router } from "express";
import { serve } from "inngest/express";

import { inngest, functions } from "../inngest/index.js";

const router = Router();

router.use("/", serve({ client: inngest, functions }));

export default router;
