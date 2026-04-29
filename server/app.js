import express from "express";
import cors from "cors";
import { clerkMiddleware } from "@clerk/express";

import healthRoutes from "./routes/healthRoutes.js";
import workspaceRoutes from "./routes/workspaceRoutes.js";
import projectRoutes from "./routes/projectRoutes.js";
import inngestRoutes from "./routes/inngestRoutes.js";
import { notFoundHandler, errorHandler } from "./middlewares/errorHandler.js";

const app = express();

app.use(express.json());
app.use(cors());

app.use("/", healthRoutes);
app.use("/api/workspaces", clerkMiddleware(), workspaceRoutes);
app.use("/api/projects", clerkMiddleware(), projectRoutes);
app.use("/api/inngest", inngestRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
