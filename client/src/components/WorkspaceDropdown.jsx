import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Plus, Trash2, Edit } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import { setCurrentWorkspace, deleteWorkspace } from "../features/workspaceSlice";
import { useNavigate } from "react-router-dom";
import CreateWorkspaceDialog from "./CreateWorkspaceDialog";
import { toast } from "react-toastify";
import { apiFetch } from "../lib/api";

function WorkspaceDropdown() {

    const { workspaces } = useSelector((state) => state.workspace);
    const currentWorkspace = useSelector((state) => state.workspace?.currentWorkspace || null);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [isCreateWorkspaceOpen, setIsCreateWorkspaceOpen] = useState(false);
    const [workspaceToEdit, setWorkspaceToEdit] = useState(null);

    const onSelectWorkspace = (organizationId) => {
        dispatch(setCurrentWorkspace(organizationId))
        setIsOpen(false);
        navigate('/')
    }

    const handleEditWorkspace = (workspace) => {
        setWorkspaceToEdit(workspace);
        setIsCreateWorkspaceOpen(true);
    }

    const handleDeleteWorkspace = async (workspaceId) => {
        try {
            const response = await apiFetch("/api/workspaces/delete", {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    workspaceId,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Failed to delete workspace");
            }

            dispatch(deleteWorkspace(workspaceId));
            toast.success("Workspace deleted successfully!");
        } catch (error) {
            toast.error(error.message || "Failed to delete workspace");
        }
    }

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Reset workspaceToEdit when dialog closes
    useEffect(() => {
        if (!isCreateWorkspaceOpen) {
            setWorkspaceToEdit(null);
        }
    }, [isCreateWorkspaceOpen]);

    return (
        <div className="relative m-4" ref={dropdownRef}>
            <button onClick={() => setIsOpen(prev => !prev)} className="w-full flex items-center justify-between p-3 h-auto text-left rounded hover:bg-gray-100 dark:hover:bg-zinc-800" >
                <div className="flex items-center gap-3">
                    <img src={currentWorkspace?.image_url} alt={currentWorkspace?.name} className="w-8 h-8 rounded shadow" />
                    <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-800 dark:text-white text-sm truncate">
                            {currentWorkspace?.name || "Select Workspace"}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-zinc-400 truncate">
                            {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}
                        </p>
                    </div>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-500 dark:text-zinc-400 flex-shrink-0" />
            </button>

            {isOpen && (
                <div className="absolute z-50 w-64 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded shadow-lg top-full left-0">
                    <div className="p-2">
                        <p className="text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2 px-2">
                            Workspaces
                        </p>
                    {workspaces.map((ws) => (
                        <div key={ws.id} onClick={() => onSelectWorkspace(ws.id)} className="flex items-center gap-3 p-2 cursor-pointer rounded hover:bg-gray-100 dark:hover:bg-zinc-800" >
                            <img src={ws.image_url} alt={ws.name} className="w-6 h-6 rounded" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                                    {ws.name}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-zinc-400 truncate">
                                    {ws.members?.length || 0} members
                                </p>
                            </div>
                            {currentWorkspace?.id === ws.id && (
                                <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                            )}
                            <div className="flex gap-1">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditWorkspace(ws);
                                    }}
                                    className="p-1 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                                    title="Edit workspace"
                                >
                                    <Edit className="w-4 h-4" />
                                </button>
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (window.confirm('Are you sure you want to delete this workspace?')) {
                                            handleDeleteWorkspace(ws.id);
                                        }
                                    }}
                                    className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                    title="Delete workspace"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                    </div>

                    <hr className="border-gray-200 dark:border-zinc-700" />

                    <div className="p-2 cursor-pointer rounded group hover:bg-gray-100 dark:hover:bg-zinc-800" onClick={() => setIsCreateWorkspaceOpen(true)}>
                        <p className="flex items-center text-xs gap-2 my-1 w-full text-blue-600 dark:text-blue-400 group-hover:text-blue-500 dark:group-hover:text-blue-300">
                            <Plus className="w-4 h-4" /> Create Workspace
                        </p>
                    </div>
                </div>
            )}

            <CreateWorkspaceDialog
                isDialogOpen={isCreateWorkspaceOpen}
                setIsDialogOpen={setIsCreateWorkspaceOpen}
                workspaceToEdit={workspaceToEdit}
            />
        </div>
    );
}

export default WorkspaceDropdown;
