import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { dummyWorkspaces } from "../assets/assets";
import { apiFetch } from "../lib/api";

// Load workspaces from localStorage or use dummy data as fallback
const savedWorkspaces = localStorage.getItem("workspaces");
const savedCurrentWorkspaceId = localStorage.getItem("currentWorkspaceId");
const parsedSavedWorkspaces = savedWorkspaces ? JSON.parse(savedWorkspaces) : null;
const initialWorkspaces = parsedSavedWorkspaces || dummyWorkspaces || [];
const initialCurrentWorkspace =
    initialWorkspaces.find((workspace) => workspace.id === savedCurrentWorkspaceId) ||
    initialWorkspaces[0] ||
    null;

const persistWorkspaceState = (workspaces, currentWorkspace) => {
    localStorage.setItem("workspaces", JSON.stringify(workspaces));

    if (currentWorkspace?.id) {
        localStorage.setItem("currentWorkspaceId", currentWorkspace.id);
        return;
    }

    localStorage.removeItem("currentWorkspaceId");
};

export const fetchWorkspaces = createAsyncThunk(
    "workspace/fetchWorkspaces",
    async (_, { rejectWithValue }) => {
        try {
            const response = await apiFetch("/api/workspaces");

            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                return rejectWithValue(data.error || "Failed to fetch workspaces");
            }

            return response.json();
        } catch (error) {
            return rejectWithValue(error.message || "Failed to fetch workspaces");
        }
    }
);

const initialState = {
    workspaces: initialWorkspaces,
    currentWorkspace: initialCurrentWorkspace,
    loading: false,
    error: null,
};

const workspaceSlice = createSlice({
    name: "workspace",
    initialState,
    reducers: {
        setWorkspaces: (state, action) => {
            state.workspaces = action.payload;
            state.currentWorkspace =
                state.workspaces.find((w) => w.id === state.currentWorkspace?.id) ||
                state.workspaces[0] ||
                null;
            state.error = null;
            persistWorkspaceState(state.workspaces, state.currentWorkspace);
        },
        setCurrentWorkspace: (state, action) => {
            localStorage.setItem("currentWorkspaceId", action.payload);
            state.currentWorkspace = state.workspaces.find((w) => w.id === action.payload);
        },
        addWorkspace: (state, action) => {
            state.workspaces.push(action.payload);
            
            // Save to localStorage
            localStorage.setItem('workspaces', JSON.stringify(state.workspaces));

            // set current workspace to the new workspace
            if (state.currentWorkspace?.id !== action.payload.id) {
                state.currentWorkspace = action.payload;
            }

            persistWorkspaceState(state.workspaces, state.currentWorkspace);
        },
        updateWorkspace: (state, action) => {
            state.workspaces = state.workspaces.map((w) =>
                w.id === action.payload.id ? action.payload : w
            );

            // if current workspace is updated, set it to the updated workspace
            if (state.currentWorkspace?.id === action.payload.id) {
                state.currentWorkspace = action.payload;
            }

            persistWorkspaceState(state.workspaces, state.currentWorkspace);
        },
        deleteWorkspace: (state, action) => {
            state.workspaces = state.workspaces.filter((w) => w.id !== action.payload);

            if (state.currentWorkspace?.id === action.payload) {
                state.currentWorkspace = state.workspaces[0] || null;
            }

            persistWorkspaceState(state.workspaces, state.currentWorkspace);
        },
        addProject: (state, action) => {
            state.currentWorkspace.projects.push(action.payload);
            // find workspace by id and add project to it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? { ...w, projects: w.projects.concat(action.payload) } : w
            );
            
            persistWorkspaceState(state.workspaces, state.currentWorkspace);
        },
        addTask: (state, action) => {

            state.currentWorkspace.projects = state.currentWorkspace.projects.map((p) => {
                console.log(p.id, action.payload.projectId, p.id === action.payload.projectId);
                if (p.id === action.payload.projectId) {
                    p.tasks.push(action.payload);
                }
                return p;
            });

            // find workspace and project by id and add task to it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? {
                    ...w, projects: w.projects.map((p) =>
                        p.id === action.payload.projectId ? { ...p, tasks: p.tasks.concat(action.payload) } : p
                    )
                } : w
            );
            
            persistWorkspaceState(state.workspaces, state.currentWorkspace);
        },
        updateTask: (state, action) => {
            state.currentWorkspace.projects.map((p) => {
                if (p.id === action.payload.projectId) {
                    p.tasks = p.tasks.map((t) =>
                        t.id === action.payload.id ? action.payload : t
                    );
                }
            });
            // find workspace and project by id and update task in it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? {
                    ...w, projects: w.projects.map((p) =>
                        p.id === action.payload.projectId ? {
                            ...p, tasks: p.tasks.map((t) =>
                                t.id === action.payload.id ? action.payload : t
                            )
                        } : p
                    )
                } : w
            );
            
            persistWorkspaceState(state.workspaces, state.currentWorkspace);
        },
        deleteTask: (state, action) => {
            state.currentWorkspace.projects.map((p) => {
                p.tasks = p.tasks.filter((t) => !action.payload.includes(t.id));
                return p;
            });
            // find workspace and project by id and delete task from it
            state.workspaces = state.workspaces.map((w) =>
                w.id === state.currentWorkspace.id ? {
                    ...w, projects: w.projects.map((p) =>
                        p.id === action.payload.projectId ? {
                            ...p, tasks: p.tasks.filter((t) => !action.payload.includes(t.id))
                        } : p
                    )
                } : w
            );
            
            persistWorkspaceState(state.workspaces, state.currentWorkspace);
        }

    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchWorkspaces.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchWorkspaces.fulfilled, (state, action) => {
                state.loading = false;
                state.workspaces = action.payload;
                state.currentWorkspace =
                    action.payload.find((workspace) => workspace.id === state.currentWorkspace?.id) ||
                    action.payload.find((workspace) => workspace.id === savedCurrentWorkspaceId) ||
                    action.payload[0] ||
                    null;
                persistWorkspaceState(state.workspaces, state.currentWorkspace);
            })
            .addCase(fetchWorkspaces.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload || "Failed to fetch workspaces";
            });
    },
});

export const { setWorkspaces, setCurrentWorkspace, addWorkspace, updateWorkspace, deleteWorkspace, addProject, addTask, updateTask, deleteTask } = workspaceSlice.actions;
export default workspaceSlice.reducer;
