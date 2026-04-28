import { useEffect, useState } from "react";
import { XIcon, Plus, UserPlus, Users, Upload, Edit } from "lucide-react";
import { useSelector, useDispatch } from "react-redux";
import { addWorkspace, updateWorkspace } from "../features/workspaceSlice";
import { toast } from "react-toastify";
import { useUser } from "@clerk/clerk-react";
import { apiFetch } from "../lib/api";

const CreateWorkspaceDialog = ({ isDialogOpen, setIsDialogOpen, workspaceToEdit = null }) => {
    const dispatch = useDispatch();
    const { workspaces } = useSelector((state) => state.workspace);
    const { user } = useUser();

    const [formData, setFormData] = useState({
        name: workspaceToEdit?.name || "",
        description: workspaceToEdit?.description || "",
        visibility: workspaceToEdit?.visibility || "PRIVATE",
        members: workspaceToEdit?.members || [],
        createProject: false,
        projectName: "",
        image: null,
        imagePreview: workspaceToEdit?.image_url || null
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [currentStep, setCurrentStep] = useState(1); // 1: Basic Info, 2: Members, 3: Project

    useEffect(() => {
        setFormData({
            name: workspaceToEdit?.name || "",
            description: workspaceToEdit?.description || "",
            visibility: workspaceToEdit?.visibility || "PRIVATE",
            members: workspaceToEdit?.members || [],
            createProject: false,
            projectName: "",
            image: null,
            imagePreview: workspaceToEdit?.image_url || null
        });
        setCurrentStep(1);
    }, [workspaceToEdit, isDialogOpen]);

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleImageUpload = (event) => {
        const file = event.target.files[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                toast.error("Please upload an image file");
                return;
            }
            
            if (file.size > 5 * 1024 * 1024) { // 5MB limit
                toast.error("Image size must be less than 5MB");
                return;
            }

            setFormData(prev => ({ ...prev, image: file }));
            
            // Create preview URL
            const reader = new FileReader();
            reader.onload = (e) => {
                setFormData(prev => ({ ...prev, imagePreview: e.target.result }));
            };
            reader.readAsDataURL(file);
        }
    };

    const removeImage = () => {
        setFormData(prev => ({ ...prev, image: null, imagePreview: null }));
    };

    const addMember = (email, role) => {
        if (email && !formData.members.some(m => m.email === email)) {
            setFormData(prev => ({
                ...prev,
                members: [...prev.members, { email, role: role || 'MEMBER' }]
            }));
        }
    };

    const removeMember = (email) => {
        setFormData(prev => ({
            ...prev,
            members: prev.members.filter(m => m.email !== email)
        }));
    };

    const updateMemberRole = (email, role) => {
        setFormData(prev => ({
            ...prev,
            members: prev.members.map(m => m.email === email ? { ...m, role } : m)
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            if (workspaceToEdit) {
                const response = await apiFetch("/api/workspaces/update", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        workspaceId: workspaceToEdit.id,
                        name: formData.name,
                        description: formData.description,
                        image_url: formData.imagePreview || workspaceToEdit.image_url,
                    }),
                });

                const updatedWorkspace = await response.json();

                if (!response.ok) {
                    throw new Error(updatedWorkspace.error || "Failed to update workspace");
                }

                dispatch(updateWorkspace({
                    name: formData.name,
                    ...updatedWorkspace,
                }));
                toast.success("Workspace updated successfully!");
            } else {
                const response = await apiFetch("/api/workspaces/create", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        name: formData.name,
                        description: formData.description,
                        image_url: formData.imagePreview || "",
                        actor: user ? {
                            name: user.fullName || user.username || user.primaryEmailAddress?.emailAddress,
                            email: user.primaryEmailAddress?.emailAddress,
                            image: user.imageUrl || "",
                        } : null,
                    }),
                });

                const newWorkspace = await response.json();

                if (!response.ok) {
                    throw new Error(newWorkspace.error || "Failed to create workspace");
                }

                if (formData.createProject && formData.projectName && user?.id) {
                    const projectResponse = await apiFetch("/api/projects/create", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            name: formData.projectName,
                            description: "First project in this workspace",
                            status: "PLANNING",
                            priority: "MEDIUM",
                            start_date: new Date().toISOString(),
                            team_lead: user.id,
                            workspaceId: newWorkspace.id,
                            actor: {
                                name: user.fullName || user.username || user.primaryEmailAddress?.emailAddress,
                                email: user.primaryEmailAddress?.emailAddress,
                                image: user.imageUrl || "",
                            },
                        }),
                    });

                    const createdProject = await projectResponse.json();

                    if (!projectResponse.ok) {
                        throw new Error(createdProject.error || "Workspace was created, but the first project could not be created");
                    }

                    newWorkspace.projects = [createdProject];
                }

                dispatch(addWorkspace(newWorkspace));
                toast.success("Workspace created successfully!");
            }

            if (formData.members.length > 0) {
                toast.info("Workspace member invitations are not wired to the backend yet.");
            }
            
            // Reset form and close dialog
            setFormData({
                name: "",
                description: "",
                visibility: "PRIVATE",
                members: [],
                createProject: false,
                projectName: "",
                image: null,
                imagePreview: null
            });
            
            setCurrentStep(1);
            setIsDialogOpen(false);
            
        } catch (error) {
            console.error('Error processing workspace:', error);
            toast.error(error.message || "Failed to process workspace. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const nextStep = () => {
        if (currentStep === 1 && !formData.name.trim()) {
            toast.error("Workspace name is required");
            return;
        }
        setCurrentStep(prev => prev + 1);
    };

    const prevStep = () => {
        setCurrentStep(prev => prev - 1);
    };

    if (!isDialogOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/20 dark:bg-black/60 backdrop-blur flex items-center justify-center text-left z-50">
            <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 w-full max-w-lg text-zinc-900 dark:text-zinc-200 relative">
                <button 
                    className="absolute top-3 right-3 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" 
                    onClick={() => setIsDialogOpen(false)}
                >
                    <XIcon className="size-5" />
                </button>

                {/* Progress Indicator */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-medium">{workspaceToEdit ? 'Edit Workspace' : 'Create Workspace'}</h2>
                    <div className="flex gap-2">
                        {[1, 2, 3].map((step) => (
                            <div
                                key={step}
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                                    currentStep === step
                                        ? 'bg-blue-500 text-white'
                                        : currentStep > step
                                        ? 'bg-green-500 text-white'
                                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                                }`}
                            >
                                {currentStep > step ? '✓' : step}
                            </div>
                        ))}
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Step 1: Basic Information */}
                    {currentStep === 1 && (
                        <div className="space-y-4 animate-in slide-in-from-left-2 duration-200">
                            {/* Workspace Icon/Logo */}
                            <div>
                                <label className="block text-sm mb-1 font-medium">Workspace Icon/Logo</label>
                                <div className="flex items-center gap-4">
                                    <div className="relative">
                                        {formData.imagePreview ? (
                                            <div className="relative">
                                                <img 
                                                    src={formData.imagePreview} 
                                                    alt="Workspace preview" 
                                                    className="w-16 h-16 rounded-full object-cover border-2 border-zinc-300 dark:border-zinc-600"
                                                />
                                                <button
                                                    onClick={removeImage}
                                                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                                                >
                                                    x
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="w-16 h-16 bg-zinc-200 dark:bg-zinc-700 rounded-full flex items-center justify-center">
                                                <Users className="w-8 h-8 text-zinc-500 dark:text-zinc-400" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <label className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700">
                                            <Upload className="w-4 h-4" />
                                            <span className="text-sm">Upload Image</span>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={handleImageUpload}
                                                className="hidden"
                                            />
                                        </label>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">PNG, JPG up to 5MB</p>
                                    </div>
                                </div>
                            </div>

                            {/* Workspace Name */}
                            <div>
                                <label className="block text-sm mb-1 font-medium">Workspace Name</label>
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        value={formData.name} 
                                        onChange={(e) => handleInputChange('name', e.target.value)}
                                        placeholder="Enter workspace name"
                                        className="w-full px-3 py-2 pl-10 rounded dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 mt-1 text-zinc-900 dark:text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        required
                                    />
                                    <Users className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                                </div>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">This will be the name of your workspace</p>
                            </div>

                            {/* Workspace Description */}
                            <div>
                                <label className="block text-sm mb-1 font-medium">Workspace Description</label>
                                <textarea 
                                    value={formData.description} 
                                    onChange={(e) => handleInputChange('description', e.target.value)}
                                    placeholder="Describe what this workspace is for (optional)"
                                    className="w-full px-3 py-2 rounded dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 mt-1 text-zinc-900 dark:text-zinc-200 text-sm h-20 resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>

                            {/* Workspace Visibility */}
                            <div>
                                <label className="block text-sm mb-2 font-medium">Workspace Visibility</label>
                                <div className="space-y-2">
                                    <label className="flex items-center space-x-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            value="PRIVATE"
                                            checked={formData.visibility === "PRIVATE"}
                                            onChange={(e) => handleInputChange('visibility', e.target.value)}
                                            className="form-radio h-4 w-4 text-blue-600"
                                        />
                                        <div>
                                            <div className="font-medium">Private</div>
                                            <div className="text-xs text-zinc-600 dark:text-zinc-400">Only invited members can access</div>
                                        </div>
                                    </label>
                                    <label className="flex items-center space-x-3 cursor-pointer">
                                        <input
                                            type="radio"
                                            value="PUBLIC"
                                            checked={formData.visibility === "PUBLIC"}
                                            onChange={(e) => handleInputChange('visibility', e.target.value)}
                                            className="form-radio h-4 w-4 text-blue-600"
                                        />
                                        <div>
                                            <div className="font-medium">Public</div>
                                            <div className="text-xs text-zinc-600 dark:text-zinc-400">Anyone in the organization can access</div>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Invite Members */}
                    {currentStep === 2 && (
                        <div className="space-y-4 animate-in slide-in-from-left-2 duration-200">
                            <div className="flex items-center gap-3 mb-4">
                                <UserPlus className="w-5 h-5 text-blue-600" />
                                <div>
                                    <h3 className="font-medium">Invite Members</h3>
                                    <p className="text-sm text-zinc-600 dark:text-zinc-400">Add team members to your workspace</p>
                                </div>
                            </div>

                            {/* Add Member Form */}
                            <div className="space-y-3">
                                <div className="grid grid-cols-3 gap-2">
                                    <input 
                                        type="email" 
                                        id="memberEmail"
                                        placeholder="member@company.com"
                                        className="col-span-2 px-3 py-2 rounded dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                    <select 
                                        id="memberRole"
                                        className="px-3 py-2 rounded dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-200 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    >
                                        <option value="MEMBER">Member</option>
                                        <option value="ADMIN">Admin</option>
                                    </select>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const emailInput = document.getElementById('memberEmail');
                                        const roleInput = document.getElementById('memberRole');
                                        if (emailInput.value) {
                                            addMember(emailInput.value, roleInput.value);
                                            emailInput.value = '';
                                        }
                                    }}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add 
                                </button>
                            </div>

                            {/* Member List */}
                            {formData.members.length > 0 && (
                                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-3">
                                    <h4 className="text-sm font-medium mb-2">Invited Members</h4>
                                    <div className="space-y-2">
                                        {formData.members.map((member, index) => (
                                            <div key={index} className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-900 rounded">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                                                        <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                                                            {member.email.charAt(0).toUpperCase()}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-sm">{member.email}</div>
                                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{member.role}</div>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <select
                                                        value={member.role}
                                                        onChange={(e) => updateMemberRole(member.email, e.target.value)}
                                                        className="text-xs px-2 py-1 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800"
                                                    >
                                                        <option value="MEMBER">Member</option>
                                                        <option value="ADMIN">Admin</option>
                                                    </select>
                                                    <button
                                                        onClick={() => removeMember(member.email)}
                                                        className="text-red-500 hover:text-red-700"
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Step 3: Create First Project */}
                    {currentStep === 3 && (
                        <div className="space-y-4 animate-in slide-in-from-left-2 duration-200">
                            <div className="flex items-center gap-3 mb-4">
                                <Plus className="w-5 h-5 text-green-600" />
                                <div>
                                    <h3 className="font-medium">Create First Project (Optional)</h3>
                                    <p className="text-sm text-zinc-600 dark:text-zinc-400">Set up your first project to get started quickly</p>
                                </div>
                            </div>

                            <div className="flex items-center space-x-2">
                                <input
                                    type="checkbox"
                                    id="createProject"
                                    checked={formData.createProject}
                                    onChange={(e) => handleInputChange('createProject', e.target.checked)}
                                    className="form-checkbox h-4 w-4 text-green-600"
                                />
                                <label htmlFor="createProject" className="text-sm font-medium">Create first project</label>
                            </div>

                            {formData.createProject && (
                                <div>
                                    <label className="block text-sm mb-1 font-medium">Project Name</label>
                                    <input 
                                        type="text" 
                                        value={formData.projectName} 
                                        onChange={(e) => handleInputChange('projectName', e.target.value)}
                                        placeholder="e.g., Website Redesign, Mobile App Development"
                                        className="w-full px-3 py-2 rounded dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 mt-1 text-zinc-900 dark:text-zinc-200 text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    />
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">This will be your first project in the workspace</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Navigation Buttons */}
                    <div className="flex justify-between pt-4 border-t border-zinc-200 dark:border-zinc-700">
                        <button 
                            type="button" 
                            onClick={currentStep > 1 ? prevStep : () => setIsDialogOpen(false)}
                            className="px-4 py-2 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-sm"
                        >
                            {currentStep > 1 ? 'Back' : 'Cancel'}
                        </button>
                        
                        {currentStep < 3 ? (
                            <button 
                                type="button" 
                                onClick={nextStep}
                                className="px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors text-sm"
                            >
                                Next
                            </button>
                        ) : (
                            <button 
                                type="submit"
                                disabled={isSubmitting || !formData.name.trim()}
                                className="px-4 py-2 rounded bg-gradient-to-r from-blue-500 to-green-500 text-white hover:from-blue-600 hover:to-green-600 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSubmitting ? (workspaceToEdit ? "Updating Workspace..." : "Creating Workspace...") : (workspaceToEdit ? "Update Workspace" : "Create Workspace")}
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateWorkspaceDialog;
