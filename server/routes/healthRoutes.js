import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
  res.send("Server is live!");
});

export default router;
