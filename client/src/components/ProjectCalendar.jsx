import { useState } from "react";
import { format, isSameDay, isBefore, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, differenceInDays, addDays } from "date-fns";
import { CalendarIcon, Clock, User, ChevronLeft, ChevronRight, GanttChart, Download } from "lucide-react";
import * as XLSX from 'xlsx';

const typeColors = {
    BUG: "bg-red-200 text-red-800 dark:bg-red-500 dark:text-red-900",
    FEATURE: "bg-blue-200 text-blue-800 dark:bg-blue-500 dark:text-blue-900",
    TASK: "bg-green-200 text-green-800 dark:bg-green-500 dark:text-green-900",
    IMPROVEMENT: "bg-purple-200 text-purple-800 dark:bg-purple-500 dark:text-purple-900",
    OTHER: "bg-amber-200 text-amber-800 dark:bg-amber-500 dark:text-amber-900",
};

const priorityBorders = {
    LOW: "border-zinc-300 dark:border-zinc-600",
    MEDIUM: "border-amber-300 dark:border-amber-500",
    HIGH: "border-orange-300 dark:border-orange-500",
};

// Gantt Chart Component
const ProjectGanttChart = ({ tasks }) => {
    const [startDate, setStartDate] = useState(new Date());
    const [timeScale, setTimeScale] = useState("week"); // "week", "month", "quarter"

    // Sort tasks by start date
    const sortedTasks = [...tasks]
        .filter(task => task.start_date && task.due_date)
        .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    // Calculate date range for Gantt view
    const getDateRange = () => {
        if (sortedTasks.length === 0) {
            return {
                start: startDate,
                end: addDays(startDate, timeScale === "week" ? 7 : timeScale === "month" ? 30 : 90)
            };
        }

        const earliestStart = new Date(sortedTasks[0].start_date);
        const latestEnd = new Date(sortedTasks[sortedTasks.length - 1].due_date);
        
        return {
            start: earliestStart,
            end: latestEnd
        };
    };

    const range = getDateRange();
    const totalDays = differenceInDays(range.end, range.start) + 1;

    // Generate timeline columns
    const generateColumns = () => {
        const columns = [];
        let currentDate = range.start;
        
        while (currentDate <= range.end) {
            columns.push(new Date(currentDate));
            currentDate = addDays(currentDate, 1);
        }
        
        return columns;
    };

    const timelineColumns = generateColumns();

    // Calculate task position and width
    const getTaskStyle = (task) => {
        const taskStart = new Date(task.start_date);
        const taskEnd = new Date(task.due_date);
        
        const startOffset = differenceInDays(taskStart, range.start);
        const taskDuration = differenceInDays(taskEnd, taskStart) + 1;
        
        const left = (startOffset / totalDays) * 100;
        const width = (taskDuration / totalDays) * 100;
        
        return {
            left: `${left}%`,
            width: `${width}%`
        };
    };

    const handleTimeScaleChange = (direction) => {
        const daysToAdd = timeScale === "week" ? 7 : timeScale === "month" ? 30 : 90;
        setStartDate(prev => direction === "next" ? addDays(prev, daysToAdd) : addDays(prev, -daysToAdd));
    };

    const handleExport = () => {
        // Prepare data for export
        const worksheetData = [
            ['Project Timeline Export'],
            ['Date Range:', format(range.start, "yyyy-MM-dd"), 'to', format(range.end, "yyyy-MM-dd")],
            ['Time Scale:', timeScale],
            [],
            ['Task ID', 'Title', 'Type', 'Priority', 'Assignee', 'Start Date', 'Due Date', 'Duration (Days)'],
            ...sortedTasks.map(task => [
                task.id,
                task.title,
                task.type,
                task.priority,
                task.assignee?.name || "Unassigned",
                format(task.start_date, "yyyy-MM-dd"),
                format(task.due_date, "yyyy-MM-dd"),
                differenceInDays(new Date(task.due_date), new Date(task.start_date)) + 1
            ])
        ];

        // Create worksheet and workbook
        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Project Timeline');

        // Export to Excel file
        XLSX.writeFile(workbook, `project-timeline-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    };

    return (
        <div className="mt-6 bg-white dark:bg-zinc-950 dark:bg-gradient-to-br dark:from-zinc-800/70 dark:to-zinc-900/50 border border-zinc-300 dark:border-zinc-800 rounded-lg p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-zinc-900 dark:text-white text-md flex gap-2 items-center">
                    <GanttChart className="size-5" /> Project Timeline
                </h2>
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition"
                    >
                        <Download className="size-4" />
                        Export
                    </button>
                    <select
                        value={timeScale}
                        onChange={(e) => setTimeScale(e.target.value)}
                        className="text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded px-2 py-1 text-zinc-900 dark:text-white"
                    >
                        <option value="week">Week</option>
                        <option value="month">Month</option>
                        <option value="quarter">Quarter</option>
                    </select>
                    <div className="flex gap-2 items-center">
                        <button onClick={() => handleTimeScaleChange("prev")}>
                            <ChevronLeft className="size-5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white" />
                        </button>
                        <span className="text-zinc-900 dark:text-white text-sm">
                            {format(range.start, "MMM d")} - {format(range.end, "MMM d, yyyy")}
                        </span>
                        <button onClick={() => handleTimeScaleChange("next")}>
                            <ChevronRight className="size-5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Timeline Header */}
            <div className="relative mb-2 border-b border-zinc-300 dark:border-zinc-700 pb-2">
                <div className="flex text-xs text-zinc-600 dark:text-zinc-400">
                    {timelineColumns.map((date, index) => (
                        <div
                            key={index}
                            className="flex-1 text-center"
                            style={{ minWidth: timeScale === "week" ? "40px" : timeScale === "month" ? "30px" : "20px" }}
                        >
                            {index === 0 || date.getDate() === 1 ? format(date, "MMM d") : format(date, "d")}
                        </div>
                    ))}
                </div>
            </div>

            {/* Gantt Chart Rows */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
                {sortedTasks.length === 0 ? (
                    <p className="text-center text-zinc-500 dark:text-zinc-400 py-8">
                        No tasks with start and due dates
                    </p>
                ) : (
                    sortedTasks.map((task) => (
                        <div key={task.id} className="relative h-12 group">
                            {/* Task Info */}
                            <div className="absolute left-0 top-0 bottom-0 w-48 flex items-center z-10 bg-gradient-to-r from-white dark:from-zinc-900 to-transparent pr-4">
                                <div className="flex flex-col">
                                    <span className="text-sm text-zinc-900 dark:text-white truncate max-w-[180px]">
                                        {task.title}
                                    </span>
                                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                        {format(task.start_date, "MMM d")} - {format(task.due_date, "MMM d")}
                                    </span>
                                </div>
                            </div>

                            {/* Timeline Grid */}
                            <div className="ml-48 relative h-full">
                                {/* Background grid */}
                                <div className="absolute inset-0 flex">
                                    {timelineColumns.map((_, index) => (
                                        <div
                                            key={index}
                                            className="flex-1 border-l border-zinc-200 dark:border-zinc-800 h-full"
                                        />
                                    ))}
                                </div>

                                {/* Task Bar */}
                                <div
                                    className={`absolute top-1 bottom-1 rounded ${typeColors[task.type]} border-2 ${priorityBorders[task.priority]} opacity-80 hover:opacity-100 transition-opacity cursor-pointer group`}
                                    style={getTaskStyle(task)}
                                >
                                    {/* Tooltip on hover */}
                                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs rounded py-1 px-2 whitespace-nowrap z-20">
                                        <p className="font-medium">{task.title}</p>
                                        <p>Start: {format(task.start_date, "MMM d")}</p>
                                        <p>Due: {format(task.due_date, "MMM d")}</p>
                                        {task.assignee && <p>Assignee: {task.assignee.name}</p>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Legend */}
            <div className="mt-4 pt-4 border-t border-zinc-300 dark:border-zinc-700">
                <div className="flex flex-wrap gap-4 text-xs">
                    <div className="flex items-center gap-2">
                        <span className="text-zinc-600 dark:text-zinc-400">Task Types:</span>
                    </div>
                    {Object.entries(typeColors).map(([type, colorClass]) => (
                        <div key={type} className="flex items-center gap-1">
                            <div className={`w-3 h-3 rounded ${colorClass.split(" ")[0]}`} />
                            <span className="text-zinc-600 dark:text-zinc-400">{type}</span>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap gap-4 mt-2 text-xs">
                    <div className="flex items-center gap-2">
                        <span className="text-zinc-600 dark:text-zinc-400">Priority:</span>
                    </div>
                    {Object.entries(priorityBorders).map(([priority, borderClass]) => (
                        <div key={priority} className="flex items-center gap-1">
                            <div className={`w-3 h-3 border-2 ${borderClass}`} />
                            <span className="text-zinc-600 dark:text-zinc-400 capitalize">{priority.toLowerCase()}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// Main Calendar Component
const ProjectCalendar = ({ tasks }) => {
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [currentMonth, setCurrentMonth] = useState(new Date());

    const today = new Date();
    const getTasksForDate = (date) => tasks.filter((task) => isSameDay(task.due_date, date));

    const upcomingTasks = tasks
        .filter((task) => task.due_date && !isBefore(task.due_date, today) && task.status !== "DONE")
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
        .slice(0, 5);

    const overdueTasks = tasks.filter((task) => task.due_date && isBefore(task.due_date, today) && task.status !== "DONE");

    const daysInMonth = eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth),
    });

    const handleMonthChange = (direction) => {
        setCurrentMonth((prev) => (direction === "next" ? addMonths(prev, 1) : subMonths(prev, 1)));
    };

    return (
        <>
            <div className="grid lg:grid-cols-3 gap-6">
                {/* Calendar View */}
                <div className="lg:col-span-2 ">
                    <div className="not-dark:bg-white dark:bg-gradient-to-br dark:from-zinc-800/70 dark:to-zinc-900/50 border border-zinc-300 dark:border-zinc-800 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-zinc-900 dark:text-white text-md flex gap-2 items-center max-sm:hidden">
                                <CalendarIcon className="size-5" /> Task Calendar
                            </h2>
                            <div className="flex gap-2 items-center">
                                <button onClick={() => handleMonthChange("prev")}>
                                    <ChevronLeft className="size-5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white" />
                                </button>
                                <span className="text-zinc-900 dark:text-white">{format(currentMonth, "MMMM yyyy")}</span>
                                <button onClick={() => handleMonthChange("next")}>
                                    <ChevronRight className="size-5 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white" />
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-7 text-xs text-zinc-600 dark:text-zinc-400 mb-2 text-center">
                            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                                <div key={day}>{day}</div>
                            ))}
                        </div>

                        <div className="grid grid-cols-7 gap-2">
                            {daysInMonth.map((day) => {
                                const dayTasks = getTasksForDate(day);
                                const isSelected = isSameDay(day, selectedDate);
                                const hasOverdue = dayTasks.some((t) => t.status !== "DONE" && isBefore(t.due_date, today));

                                return (
                                    <button
                                        key={day}
                                        onClick={() => setSelectedDate(day)}
                                        className={`sm:h-14 rounded-md flex flex-col items-center justify-center text-sm
                                        ${isSelected ? "bg-blue-200 text-blue-900 dark:bg-blue-600 dark:text-white" : "bg-zinc-50 text-zinc-900 dark:bg-zinc-800/40 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"}
                                        ${hasOverdue ? "border border-red-300 dark:border-red-500" : ""}`}
                                    >
                                        <span>{format(day, "d")}</span>
                                        {dayTasks.length > 0 && (
                                            <span className="text-[10px] text-blue-700 dark:text-blue-400">{dayTasks.length} tasks</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Tasks for Selected Day */}
                    {getTasksForDate(selectedDate).length > 0 && (
                        <div className=" not-dark:bg-white mt-6 dark:bg-gradient-to-br dark:from-zinc-800/70 dark:to-zinc-900/50 border border-zinc-300 dark:border-zinc-800 rounded-lg p-4">
                            <h3 className="text-zinc-900 dark:text-white text-lg mb-3">
                                Tasks for {format(selectedDate, "MMM d, yyyy")}
                            </h3>
                            <div className="space-y-3">
                                {getTasksForDate(selectedDate).map((task) => (
                                    <div
                                        key={task.id}
                                        className={`bg-zinc-50 dark:bg-zinc-800/40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition p-4 rounded border-l-4 ${priorityBorders[task.priority]}`}
                                    >
                                        <div className="flex justify-between mb-2">
                                            <h4 className="text-zinc-900 dark:text-white font-medium">{task.title}</h4>
                                            <span className={`px-2 py-0.5 rounded text-xs ${typeColors[task.type]}`}>
                                                {task.type}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-xs text-zinc-600 dark:text-zinc-400">
                                            <span className="capitalize">{task.priority.toLowerCase()} priority</span>
                                            {task.assignee && (
                                                <span className="flex items-center gap-1">
                                                    <User className="w-3 h-3" />
                                                    {task.assignee.name}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Upcoming Tasks */}
                    <div className="bg-white dark:bg-zinc-950 dark:bg-gradient-to-br dark:from-zinc-800/70 dark:to-zinc-900/50 border border-zinc-300 dark:border-zinc-800 rounded-lg p-4">
                        <h3 className="text-zinc-900 dark:text-white text-sm flex items-center gap-2 mb-3">
                            <Clock className="w-4 h-4" /> Upcoming Tasks
                        </h3>
                        {upcomingTasks.length === 0 ? (
                            <p className="text-zinc-500 dark:text-zinc-400 text-sm text-center">No upcoming tasks</p>
                        ) : (
                            <div className="space-y-2">
                                {upcomingTasks.map((task) => (
                                    <div
                                        key={task.id}
                                        className="bg-zinc-50 dark:bg-zinc-800/40 hover:bg-zinc-100 dark:hover:bg-zinc-800 p-3 rounded-lg transition"
                                    >
                                        <div className="flex justify-between items-start text-sm">
                                            <span className="text-zinc-900 dark:text-white">{task.title}</span>
                                            <span className={`text-xs px-2 py-0.5 rounded ${typeColors[task.type]}`}>
                                                {task.type}
                                            </span>
                                        </div>
                                        <p className="text-xs text-zinc-600 dark:text-zinc-400">{format(task.due_date, "MMM d")}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Overdue Tasks */}
                    {overdueTasks.length > 0 && (
                        <div className="bg-white dark:bg-zinc-950  border border-red-300 dark:border-red-500 border-l-4 rounded-lg p-4">
                            <h3 className="text-red-700 dark:text-red-400 text-sm flex items-center gap-2 mb-3">
                                <Clock className="w-4 h-4" /> Overdue Tasks ({overdueTasks.length})
                            </h3>
                            <div className="space-y-2">
                                {overdueTasks.slice(0, 5).map((task) => (
                                    <div key={task.id} className="bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 p-3 rounded-lg transition" >
                                        <div className="flex justify-between text-sm text-zinc-900 dark:text-white">
                                            <span>{task.title}</span>
                                            <span className="text-xs px-2 py-0.5 rounded bg-red-200 dark:bg-red-500 text-red-900 dark:text-red-900">
                                                {task.type}
                                            </span>
                                        </div>
                                        <p className="text-xs text-red-600 dark:text-red-300">
                                            Due {format(task.due_date, "MMM d")}
                                        </p>
                                    </div>
                                ))}
                                {overdueTasks.length > 5 && (
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
                                        +{overdueTasks.length - 5} more
                                    </p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Gantt Chart below the calendar */}
            <ProjectGanttChart tasks={tasks} />
        </>
    );
};

export default ProjectCalendar;