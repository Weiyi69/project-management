import { useMemo, useState } from "react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  CartesianGrid,
  Tooltip,
  Legend
} from "recharts";
import { 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  Users, 
  ArrowRightIcon,
  Download,
  Calendar,
  FileText,
  Image,
  Filter,
  Search,
  ChevronDown,
  Settings,
  Play,
  Pause,
  CheckSquare,
  Square
} from "lucide-react";

// Colors for charts and priorities
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const PRIORITY_COLORS = {
    LOW: "text-green-600 bg-green-200 dark:text-green-500 dark:bg-green-600/20",
    MEDIUM: "text-blue-600 bg-blue-200 dark:text-blue-500 dark:bg-blue-600/20",
    HIGH: "text-red-600 bg-red-200 dark:text-red-500 dark:bg-red-600/20",
};

const STATUS_COLORS = {
    'NOT STARTED': 'bg-gray-400',
    'IN PROGRESS': 'bg-blue-500',
    'COMPLETED': 'bg-green-500',
    'ON HOLD': 'bg-yellow-500',
    'CANCELLED': 'bg-red-500',
    'DONE': 'bg-green-500',
    'TODO': 'bg-gray-400',
    'IN_PROGRESS': 'bg-blue-500'
};

const ProjectGanttChart = ({ projects = [], tasks = [], onProjectClick }) => {
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [expandedProjects, setExpandedProjects] = useState({});
    const [viewMode, setViewMode] = useState('month'); // week, month, quarter

    // Process projects and tasks for Gantt chart
    const { ganttData, dateRange, projectStats } = useMemo(() => {
        const now = new Date();
        
        // Process projects
        const projectItems = projects.map(project => {
            const startDate = new Date(project.start_date || project.created_at || now);
            const endDate = new Date(project.end_date || project.due_date || new Date(now.setMonth(now.getMonth() + 3)));
            const duration = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            
            // Calculate project progress based on tasks
            const projectTasks = tasks.filter(t => t.project_id === project.id);
            const completedTasks = projectTasks.filter(t => t.status === 'DONE' || t.status === 'COMPLETED').length;
            const progress = projectTasks.length > 0 ? Math.round((completedTasks / projectTasks.length) * 100) : 0;
            
            // Determine status
            let status = project.status || 'NOT STARTED';
            if (progress === 100) status = 'COMPLETED';
            else if (progress > 0) status = 'IN PROGRESS';
            
            return {
                id: project.id,
                name: project.name,
                type: 'project',
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
                duration,
                progress,
                status,
                priority: project.priority || 'MEDIUM',
                owner: project.owner || project.lead || 'Unassigned',
                tasks: projectTasks.length,
                completedTasks,
                members: project.members?.length || 0,
                expanded: expandedProjects[project.id] || false,
                children: []
            };
        });

        // Process tasks and group under projects
        const taskItems = tasks.map(task => {
            const startDate = new Date(task.start_date || task.created_at || now);
            const endDate = new Date(task.due_date || new Date(now.setMonth(now.getMonth() + 1)));
            const duration = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
            
            return {
                id: task.id,
                name: task.title || task.name,
                type: 'task',
                projectId: task.project_id,
                projectName: projects.find(p => p.id === task.project_id)?.name || 'Unassigned',
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0],
                duration,
                progress: task.status === 'DONE' ? 100 : task.status === 'IN_PROGRESS' ? 50 : 0,
                status: task.status,
                priority: task.priority || 'MEDIUM',
                assignee: task.assignee || 'Unassigned',
                dependencies: task.dependencies || []
            };
        });

        // Group tasks under projects
        const groupedData = projectItems.map(project => ({
            ...project,
            children: taskItems.filter(task => task.projectId === project.id)
        }));

        // Calculate date range for timeline
        const allDates = [
            ...groupedData.map(p => new Date(p.start)),
            ...groupedData.map(p => new Date(p.end)),
            ...taskItems.map(t => new Date(t.start)),
            ...taskItems.map(t => new Date(t.end))
        ];
        
        const minDate = new Date(Math.min(...allDates));
        const maxDate = new Date(Math.max(...allDates));
        const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 10;

        // Calculate project statistics
        const projectStats = {
            total: projects.length,
            completed: projects.filter(p => p.status === 'COMPLETED' || p.status === 'DONE').length,
            inProgress: projects.filter(p => p.status === 'IN_PROGRESS').length,
            notStarted: projects.filter(p => !p.status || p.status === 'NOT STARTED' || p.status === 'TODO').length,
            onHold: projects.filter(p => p.status === 'ON HOLD').length,
            delayed: projects.filter(p => {
                const endDate = new Date(p.end_date || p.due_date);
                return endDate < new Date() && p.status !== 'COMPLETED' && p.status !== 'DONE';
            }).length
        };

        return {
            ganttData: groupedData,
            dateRange: { min: minDate, max: maxDate, totalDays },
            projectStats
        };
    }, [projects, tasks, expandedProjects]);

    // Filter projects based on search and status
    const filteredData = useMemo(() => {
        return ganttData.filter(project => {
            const matchesSearch = project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                 project.owner.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
            return matchesSearch && matchesStatus;
        });
    }, [ganttData, searchTerm, statusFilter]);

    // Export functions
    const exportToCSV = () => {
        const headers = ['Type', 'Name', 'Project', 'Start Date', 'End Date', 'Duration (days)', 'Progress %', 'Status', 'Priority', 'Owner/Assignee', 'Tasks'];
        const rows = [];
        
        // Add projects
        filteredData.forEach(project => {
            rows.push([
                'Project',
                project.name,
                '-',
                project.start,
                project.end,
                project.duration,
                project.progress,
                project.status,
                project.priority,
                project.owner,
                `${project.completedTasks}/${project.tasks}`
            ]);
            
            // Add tasks if project is expanded
            if (expandedProjects[project.id]) {
                project.children.forEach(task => {
                    rows.push([
                        'Task',
                        task.name,
                        task.projectName,
                        task.start,
                        task.end,
                        task.duration,
                        task.progress,
                        task.status,
                        task.priority,
                        task.assignee,
                        '-'
                    ]);
                });
            }
        });
        
        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
        
        downloadFile(csvContent, `gantt_chart_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
        setShowExportMenu(false);
    };

    const exportToJSON = () => {
        const exportData = {
            generatedAt: new Date().toISOString(),
            summary: projectStats,
            projects: filteredData.map(project => ({
                ...project,
                children: expandedProjects[project.id] ? project.children : []
            }))
        };
        
        const jsonContent = JSON.stringify(exportData, null, 2);
        downloadFile(jsonContent, `gantt_chart_${new Date().toISOString().split('T')[0]}.json`, 'application/json');
        setShowExportMenu(false);
    };

    const exportToPNG = () => {
        // Create a formatted text report
        const content = `
╔════════════════════════════════════════════════════════════════╗
║                    GANTT CHART REPORT                          ║
╚════════════════════════════════════════════════════════════════╝

Generated: ${new Date().toLocaleString()}
Total Projects: ${projectStats.total}

SUMMARY STATISTICS
────────────────────────────────────────────────────────────────
✓ Completed: ${projectStats.completed}
▶ In Progress: ${projectStats.inProgress}
⏸ On Hold: ${projectStats.onHold}
○ Not Started: ${projectStats.notStarted}
⚠ Delayed: ${projectStats.delayed}

PROJECT TIMELINE
────────────────────────────────────────────────────────────────
${filteredData.map(project => {
    const progressBar = '█'.repeat(Math.floor(project.progress / 10)) + '░'.repeat(10 - Math.floor(project.progress / 10));
    const statusIcon = project.status === 'COMPLETED' ? '✓' : 
                      project.status === 'IN PROGRESS' ? '▶' :
                      project.status === 'ON HOLD' ? '⏸' : '○';
    
    return `
${statusIcon} ${project.name}
   ├─ Duration: ${project.start} to ${project.end} (${project.duration} days)
   ├─ Progress: [${progressBar}] ${project.progress}%
   ├─ Status: ${project.status}
   ├─ Priority: ${project.priority}
   ├─ Owner: ${project.owner}
   └─ Tasks: ${project.completedTasks}/${project.tasks} completed

${expandedProjects[project.id] ? project.children.map(task => 
`   • ${task.name}
     ├─ Duration: ${task.start} to ${task.end} (${task.duration} days)
     ├─ Status: ${task.status}
     ├─ Assignee: ${task.assignee}
     └─ Progress: ${task.progress}%`
).join('\n\n') : ''}`;
}).join('\n\n')}

────────────────────────────────────────────────────────────────
        `;
        
        downloadFile(content, `gantt_report_${new Date().toISOString().split('T')[0]}.txt`, 'text/plain');
        setShowExportMenu(false);
    };

    const downloadFile = (content, filename, type) => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleProjectExpanded = (projectId) => {
        setExpandedProjects(prev => ({
            ...prev,
            [projectId]: !prev[projectId]
        }));
    };

    const getStatusIcon = (status) => {
        switch(status) {
            case 'COMPLETED':
            case 'DONE':
                return <CheckCircle size={16} className="text-green-600 dark:text-green-400" />;
            case 'IN PROGRESS':
            case 'IN_PROGRESS':
                return <Play size={16} className="text-blue-600 dark:text-blue-400" />;
            case 'ON HOLD':
                return <Pause size={16} className="text-yellow-600 dark:text-yellow-400" />;
            default:
                return <Square size={16} className="text-gray-400 dark:text-gray-600" />;
        }
    };

    return (
        <div className="space-y-6">
            {/* Header with Controls */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                        <Calendar size={24} className="text-blue-600" />
                        Project Gantt Chart
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {projectStats.total} Projects • {projectStats.completed} Completed • {projectStats.delayed} Delayed
                    </p>
                </div>
                
                <div className="flex items-center gap-3">
                    {/* View Mode Selector */}
                    <select
                        value={viewMode}
                        onChange={(e) => setViewMode(e.target.value)}
                        className="px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white text-sm"
                    >
                        <option value="week">Week View</option>
                        <option value="month">Month View</option>
                        <option value="quarter">Quarter View</option>
                    </select>

                    {/* Export Button */}
                    <div className="relative">
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            <Download size={18} />
                            Export Chart
                        </button>
                        
                        {showExportMenu && (
                            <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 shadow-lg z-10">
                                <div className="py-1">
                                    <button
                                        onClick={exportToCSV}
                                        className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 flex items-center gap-3"
                                    >
                                        <FileText size={16} className="text-green-600" />
                                        <div>
                                            <div className="font-medium">Export as CSV</div>
                                            <div className="text-xs text-gray-500">Spreadsheet format</div>
                                        </div>
                                    </button>
                                    
                                    <button
                                        onClick={exportToJSON}
                                        className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 flex items-center gap-3"
                                    >
                                        <FileText size={16} className="text-blue-600" />
                                        <div>
                                            <div className="font-medium">Export as JSON</div>
                                            <div className="text-xs text-gray-500">Data format</div>
                                        </div>
                                    </button>
                                    
                                    <button
                                        onClick={exportToPNG}
                                        className="w-full px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 flex items-center gap-3"
                                    >
                                        <Image size={16} className="text-purple-600" />
                                        <div>
                                            <div className="font-medium">Export as Report</div>
                                            <div className="text-xs text-gray-500">Text report format</div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-4">
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1 relative">
                        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search projects or owners..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white"
                        />
                    </div>
                    
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white"
                    >
                        <option value="all">All Status</option>
                        <option value="IN PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="NOT STARTED">Not Started</option>
                        <option value="ON HOLD">On Hold</option>
                    </select>
                </div>
            </div>

            {/* Gantt Chart */}
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
                {/* Chart Header */}
                <div className="grid grid-cols-[300px_1fr] gap-4 p-4 bg-gray-50 dark:bg-zinc-700 border-b border-gray-200 dark:border-zinc-600">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                        <span>Project / Task</span>
                    </div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center justify-between">
                        <span>Timeline</span>
                        <div className="flex items-center gap-4 text-xs">
                            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-500 rounded"></span> Completed</span>
                            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded"></span> In Progress</span>
                            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-500 rounded"></span> On Hold</span>
                            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500 rounded"></span> Delayed</span>
                        </div>
                    </div>
                </div>

                {/* Chart Body */}
                <div className="divide-y divide-gray-200 dark:divide-zinc-700 max-h-[600px] overflow-y-auto">
                    {filteredData.length > 0 ? (
                        filteredData.map((project) => (
                            <div key={project.id}>
                                {/* Project Row */}
                                <div 
                                    className="grid grid-cols-[300px_1fr] gap-4 p-4 hover:bg-gray-50 dark:hover:bg-zinc-700/50 transition-colors cursor-pointer"
                                    onClick={() => {
                                        toggleProjectExpanded(project.id);
                                        if (onProjectClick) onProjectClick(project);
                                    }}
                                >
                                    <div className="flex items-center gap-3">
                                        <button className="text-gray-500 hover:text-gray-700">
                                            {expandedProjects[project.id] ? <ChevronDown size={18} /> : <ArrowRightIcon size={18} />}
                                        </button>
                                        <div className="flex items-center gap-2">
                                            {getStatusIcon(project.status)}
                                            <div>
                                                <div className="font-medium text-gray-900 dark:text-white">
                                                    {project.name}
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                    Owner: {project.owner} • Tasks: {project.completedTasks}/{project.tasks}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="relative h-10">
                                        {/* Timeline Background */}
                                        <div className="absolute inset-0 flex items-center">
                                            <div className="w-full h-2 bg-gray-200 dark:bg-zinc-700 rounded-full"></div>
                                        </div>
                                        
                                        {/* Project Bar */}
                                        <div
                                            className={`absolute h-6 rounded ${STATUS_COLORS[project.status] || 'bg-gray-400'} top-2 cursor-pointer hover:opacity-80 transition-opacity`}
                                            style={{
                                                left: `${(new Date(project.start) - dateRange.min) / (1000 * 60 * 60 * 24) * (800 / dateRange.totalDays)}px`,
                                                width: `${project.duration * (800 / dateRange.totalDays)}px`,
                                                maxWidth: '90%'
                                            }}
                                            title={`${project.name}\nStart: ${project.start}\nEnd: ${project.end}\nProgress: ${project.progress}%`}
                                        >
                                            {/* Progress Indicator */}
                                            {project.progress > 0 && project.progress < 100 && (
                                                <div
                                                    className="h-full bg-white/30 rounded-l"
                                                    style={{ width: `${project.progress}%` }}
                                                />
                                            )}
                                            
                                            {/* Duration Label */}
                                            {project.duration * (800 / dateRange.totalDays) > 60 && (
                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-white truncate">
                                                    {project.duration}d
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Task Rows (if expanded) */}
                                {expandedProjects[project.id] && project.children.map((task) => (
                                    <div 
                                        key={task.id}
                                        className="grid grid-cols-[300px_1fr] gap-4 p-4 pl-12 bg-gray-50/50 dark:bg-zinc-800/50 hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-4"></div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-gray-400"></div>
                                                <div>
                                                    <div className="text-sm text-gray-900 dark:text-white">
                                                        {task.name}
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        Assignee: {task.assignee}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="relative h-8">
                                            {/* Timeline Background */}
                                            <div className="absolute inset-0 flex items-center">
                                                <div className="w-full h-1.5 bg-gray-200 dark:bg-zinc-700 rounded-full"></div>
                                            </div>
                                            
                                            {/* Task Bar */}
                                            <div
                                                className={`absolute h-4 rounded ${STATUS_COLORS[task.status] || 'bg-gray-400'} top-2 opacity-75`}
                                                style={{
                                                    left: `${(new Date(task.start) - dateRange.min) / (1000 * 60 * 60 * 24) * (800 / dateRange.totalDays)}px`,
                                                    width: `${task.duration * (800 / dateRange.totalDays)}px`,
                                                    maxWidth: '85%'
                                                }}
                                                title={`${task.name}\nStart: ${task.start}\nEnd: ${task.end}\nStatus: ${task.status}`}
                                            >
                                                {task.duration * (800 / dateRange.totalDays) > 40 && (
                                                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-white truncate">
                                                        {task.duration}d
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))
                    ) : (
                        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                            No projects found matching your criteria
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectGanttChart;