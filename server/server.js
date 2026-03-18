import express from 'express';
import 'dotenv/config';
import cors from 'cors';
import { clerkMiddleware } from '@clerk/express';
import { serve } from "inngest/express";
import { inngest, functions } from "./inngest/index.js";
import prisma from './configs/prisma.js';

// Initialize Prisma connection on startup
async function initializePrisma() {
  try {
    await prisma.$connect();
    console.log('Prisma connected successfully');
  } catch (error) {
    console.error('Prisma connection failed:', error);
    process.exit(1);
  }
}

// Initialize Prisma when server starts
initializePrisma();

const app = express();

app.use(express.json());
app.use(cors());
app.use(clerkMiddleware());

app.get('/', (req, res) => res.send('Server is live!'));

// Workspace API endpoints
app.post('/api/workspaces/update', async (req, res) => {
  try {
    const { workspaceId, name } = req.body;

    if (!workspaceId || !name) {
      return res.status(400).json({ error: 'Workspace ID and name are required' });
    }

    // Update workspace name
    const updatedWorkspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { name },
      include: {
        members: {
          include: {
            user: true
          }
        },
        owner: true
      }
    });

    res.json(updatedWorkspace);
  } catch (error) {
    console.error('Error updating workspace:', error);
    res.status(500).json({ error: 'Failed to update workspace' });
  }
});

// Project API endpoints
app.post('/api/projects/create', async (req, res) => {
  try {
    const { name, description, status, priority, start_date, end_date, team_members, team_lead, workspaceId } = req.body;

    if (!name || !workspaceId) {
      return res.status(400).json({ error: 'Project name and workspace ID are required' });
    }

    // Create project
    const project = await prisma.project.create({
      data: {
        name,
        description,
        status,
        priority,
        start_date: start_date ? new Date(start_date) : null,
        end_date: end_date ? new Date(end_date) : null,
        team_lead,
        workspaceId,
        progress: 0
      }
    });

    // Add team members if provided
    if (team_members && team_members.length > 0) {
      const memberPromises = team_members.map(email => 
        prisma.projectMember.create({
          data: {
            projectId: project.id,
            userId: email // This assumes email is the userId, you might need to find the actual user ID
          }
        })
      );
      await Promise.all(memberPromises);
    }

    // Add team lead as member if provided
    if (team_lead) {
      await prisma.projectMember.create({
        data: {
          projectId: project.id,
          userId: team_lead
        }
      });
    }

    // Return the created project with relations
    const createdProject = await prisma.project.findUnique({
      where: { id: project.id },
      include: {
        members: {
          include: {
            user: true
          }
        }
      }
    });

    res.json(createdProject);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.put('/api/projects/update', async (req, res) => {
  try {
    const { projectId, name, description, status, priority, start_date, end_date, progress } = req.body;

    if (!projectId) {
      return res.status(400).json({ error: 'Project ID is required' });
    }

    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        name,
        description,
        status,
        priority,
        start_date: start_date ? new Date(start_date) : undefined,
        end_date: end_date ? new Date(end_date) : undefined,
        progress
      },
      include: {
        members: {
          include: {
            user: true
          }
        }
      }
    });

    res.json(updatedProject);
  } catch (error) {
    console.error('Error updating project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.post('/api/projects/add-member', async (req, res) => {
  try {
    const { projectId, email } = req.body;

    if (!projectId || !email) {
      return res.status(400).json({ error: 'Project ID and email are required' });
    }

    // Check if member already exists
    const existingMember = await prisma.projectMember.findFirst({
      where: {
        projectId,
        userId: email
      }
    });

    if (existingMember) {
      return res.status(400).json({ error: 'Member already exists in project' });
    }

    // Add member to project
    const member = await prisma.projectMember.create({
      data: {
        projectId,
        userId: email
      }
    });

    // Return updated project with members
    const updatedProject = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: {
          include: {
            user: true
          }
        }
      }
    });

    res.json(updatedProject);
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ error: 'Failed to add member to project' });
  }
});

app.use("/api/inngest", serve({ client: inngest, functions }));

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});
