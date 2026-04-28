import {
  addProjectMember,
  createProject,
  updateProject,
} from "../services/projectService.js";

export const createProjectController = async (req, res, next) => {
  try {
    const project = await createProject(req.body);
    res.json(project);
  } catch (error) {
    next(error);
  }
};

export const updateProjectController = async (req, res, next) => {
  try {
    const project = await updateProject(req.body);
    res.json(project);
  } catch (error) {
    next(error);
  }
};

export const addProjectMemberController = async (req, res, next) => {
  try {
    const project = await addProjectMember(req.body);
    res.json(project);
  } catch (error) {
    next(error);
  }
};
