import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  UserCheck,
  UserX,
  Mail,
  Shield,
  Settings,
  Search,
  Filter,
  Download,
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff
} from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'react-hot-toast';
import { useUser } from '@clerk/clerk-react';
import ExportDropdown from './ExportDropdown';

const TeamManagement = () => {
  const dispatch = useDispatch();
  const { user } = useUser();
  const { currentWorkspace, workspaces } = useSelector((state) => state.workspace);

  // State management
  const [activeTab, setActiveTab] = useState('members');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'member',
    status: 'active'
  });

  // Mock team members data
  const [teamMembers, setTeamMembers] = useState([
    {
      id: 1,
      name: 'John Doe',
      email: 'john.doe@example.com',
      role: 'admin',
      status: 'active',
      lastActive: '2 hours ago',
      projects: 5,
      tasks: 12
    },
    {
      id: 2,
      name: 'Jane Smith',
      email: 'jane.smith@example.com',
      role: 'member',
      status: 'active',
      lastActive: '1 hour ago',
      projects: 3,
      tasks: 8
    },
    {
      id: 3,
      name: 'Bob Johnson',
      email: 'bob.johnson@example.com',
      role: 'member',
      status: 'inactive',
      lastActive: '1 week ago',
      projects: 2,
      tasks: 4
    },
    {
      id: 4,
      name: 'Alice Brown',
      email: 'alice.brown@example.com',
      role: 'viewer',
      status: 'active',
      lastActive: '30 minutes ago',
      projects: 1,
      tasks: 2
    }
  ]);

  // Load data on mount
  useEffect(() => {
    // Load team members from API or local storage
    const savedMembers = localStorage.getItem('teamMembers');
    if (savedMembers) {
      setTeamMembers(JSON.parse(savedMembers));
    }
  }, []);

  // Filter and sort members
  const filteredMembers = teamMembers
    .filter(member => {
      const matchesSearch = member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           member.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === 'all' || member.role === roleFilter;
      const matchesStatus = statusFilter === 'all' || member.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    })
    .sort((a, b) => {
      let aValue, bValue;
      
      switch (sortBy) {
        case 'name':
          aValue = a.name.toLowerCase();
          bValue = b.name.toLowerCase();
          break;
        case 'email':
          aValue = a.email.toLowerCase();
          bValue = b.email.toLowerCase();
          break;
        case 'role':
          aValue = a.role;
          bValue = b.role;
          break;
        case 'status':
          aValue = a.status;
          bValue = b.status;
          break;
        case 'lastActive':
          aValue = new Date(a.lastActive).getTime();
          bValue = new Date(b.lastActive).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  // Handle member actions
  const handleInviteMember = () => {
    setShowInviteDialog(true);
  };

  const handleEditMember = (member) => {
    setEditingMember(member);
    setFormData({
      name: member.name,
      email: member.email,
      role: member.role,
      status: member.status
    });
    setIsEditing(true);
  };

  const handleDeleteMember = (memberId) => {
    if (window.confirm('Are you sure you want to remove this member?')) {
      setTeamMembers(prev => prev.filter(member => member.id !== memberId));
      toast.success('Member removed successfully!');
    }
  };

  const handleBulkAction = (action) => {
    if (selectedMembers.length === 0) {
      toast.error('Please select members to perform this action');
      return;
    }

    switch (action) {
      case 'activate':
        setTeamMembers(prev => prev.map(member => 
          selectedMembers.includes(member.id) 
            ? { ...member, status: 'active' }
            : member
        ));
        toast.success('Selected members activated!');
        break;
      case 'deactivate':
        setTeamMembers(prev => prev.map(member => 
          selectedMembers.includes(member.id) 
            ? { ...member, status: 'inactive' }
            : member
        ));
        toast.success('Selected members deactivated!');
        break;
      case 'delete':
        if (window.confirm(`Are you sure you want to remove ${selectedMembers.length} members?`)) {
          setTeamMembers(prev => prev.filter(member => !selectedMembers.includes(member.id)));
          setSelectedMembers([]);
          toast.success('Selected members removed!');
        }
        break;
    }
  };

  const handleSaveMember = () => {
    if (!formData.name || !formData.email) {
      toast.error('Please fill in all required fields');
      return;
    }

    setTeamMembers(prev => prev.map(member => 
      member.id === editingMember.id 
        ? { ...member, ...formData }
        : member
    ));
    
    toast.success('Member updated successfully!');
    setIsEditing(false);
    setEditingMember(null);
  };

  const handleInviteSubmit = (e) => {
    e.preventDefault();
    // Handle invite logic here
    toast.success('Invitation sent successfully!');
    setShowInviteDialog(false);
  };

  const toggleMemberSelection = (memberId) => {
    setSelectedMembers(prev => 
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
  };

  const selectAllMembers = () => {
    if (selectedMembers.length === filteredMembers.length) {
      setSelectedMembers([]);
    } else {
      setSelectedMembers(filteredMembers.map(member => member.id));
    }
  };

  const getRoleColor = (role) => {
    switch (role) {
      case 'admin': return 'bg-red-100 text-red-800';
      case 'member': return 'bg-blue-100 text-blue-800';
      case 'viewer': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // Generate export data
  const getExportData = () => {
    return filteredMembers.map(member => ({
      name: member.name,
      email: member.email,
      role: member.role.toUpperCase(),
      status: member.status.toUpperCase(),
      lastActive: member.lastActive,
      projects: member.projects,
      tasks: member.tasks
    }));
  };

  const tabs = [
    { id: 'members', name: 'Team Members', icon: Users },
    { id: 'invitations', name: 'Invitations', icon: Mail },
    { id: 'permissions', name: 'Permissions', icon: Shield },
    { id: 'settings', name: 'Settings', icon: Settings }
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-white">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users size={24} className="text-blue-600 dark:text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold">Team Management</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage your team members and workspace access
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ExportDropdown 
              data={getExportData()} 
              filename={`Team_Members_${new Date().toISOString().slice(0, 10)}`}
            />
            <button
              onClick={handleInviteMember}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <UserPlus size={18} />
              Invite Member
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto">
          {/* Tab Navigation */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-2 mb-6">
            <nav className="flex space-x-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.id
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700'
                    }`}
                >
                  <tab.icon size={18} />
                  {tab.name}
                </button>
              ))}
            </nav>
          </div>

          {/* Members Tab */}
          {activeTab === 'members' && (
            <div className="space-y-6">
              {/* Filters and Actions */}
              <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-6">
                <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
                  {/* Search and Filters */}
                  <div className="flex flex-col sm:flex-row gap-4 flex-1">
                    <div className="relative flex-1">
                      <Search size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                      <input
                        type="text"
                        placeholder="Search team members..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    
                    <select
                      value={roleFilter}
                      onChange={(e) => setRoleFilter(e.target.value)}
                      className="px-4 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="all">All Roles</option>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>

                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="px-4 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>

                  {/* Bulk Actions */}
                  {selectedMembers.length > 0 && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleBulkAction('activate')}
                        className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        Activate
                      </button>
                      <button
                        onClick={() => handleBulkAction('deactivate')}
                        className="px-4 py-2 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                      >
                        Deactivate
                      </button>
                      <button
                        onClick={() => handleBulkAction('delete')}
                        className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {/* Sort Options */}
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-zinc-700">
                  <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                    <span>Sort by:</span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="border border-gray-300 dark:border-zinc-600 rounded px-2 py-1 bg-white dark:bg-zinc-700 text-gray-900 dark:text-white"
                    >
                      <option value="name">Name</option>
                      <option value="email">Email</option>
                      <option value="role">Role</option>
                      <option value="status">Status</option>
                      <option value="lastActive">Last Active</option>
                    </select>
                    <button
                      onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                      className="flex items-center gap-2 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                      {sortOrder === 'asc' ? <Eye size={16} /> : <EyeOff size={16} />}
                      {sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                    </button>
                  </div>
                  
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedMembers.length > 0 && (
                      <span className="mr-4">{selectedMembers.length} selected</span>
                    )}
                    {filteredMembers.length} members
                  </div>
                </div>
              </div>

              {/* Members List */}
              <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-zinc-700 border-b border-gray-200 dark:border-zinc-600">
                      <tr>
                        <th className="px-6 py-3 text-left">
                          <input
                            type="checkbox"
                            checked={selectedMembers.length === filteredMembers.length && filteredMembers.length > 0}
                            onChange={selectAllMembers}
                            className="rounded border-gray-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Email</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Role</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Last Active</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Projects</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Tasks</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-zinc-700">
                      {filteredMembers.map((member) => (
                        <tr key={member.id} className="hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                          <td className="px-6 py-4">
                            <input
                              type="checkbox"
                              checked={selectedMembers.includes(member.id)}
                              onChange={() => toggleMemberSelection(member.id)}
                              className="rounded border-gray-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mr-3">
                                <span className="text-sm font-semibold text-blue-600 dark:text-blue-300">
                                  {member.name.split(' ').map(n => n[0]).join('')}
                                </span>
                              </div>
                              <div>
                                <div className="font-medium text-gray-900 dark:text-white">{member.name}</div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">ID: {member.id}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white">{member.email}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getRoleColor(member.role)}`}>
                              {member.role.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(member.status)}`}>
                              {member.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-500 dark:text-gray-400">{member.lastActive}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white">{member.projects}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-gray-900 dark:text-white">{member.tasks}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                            <button
                              onClick={() => handleEditMember(member)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                            >
                              <Edit size={18} />
                            </button>
                            <button
                              onClick={() => handleDeleteMember(member.id)}
                              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {filteredMembers.length === 0 && (
                  <div className="text-center py-12">
                    <Users size={48} className="mx-auto text-gray-400 dark:text-gray-600 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No team members found</h3>
                    <p className="text-gray-500 dark:text-gray-400">Try adjusting your search or filter criteria.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Invitations Tab */}
          {activeTab === 'invitations' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Pending Invitations</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-zinc-700 rounded-lg">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">sarah.wilson@example.com</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Invited as Member • 2 days ago</div>
                    </div>
                    <div className="flex gap-2">
                      <button className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                        Resend
                      </button>
                      <button className="px-4 py-2 text-sm border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Permissions Tab */}
          {activeTab === 'permissions' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Role Permissions</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-zinc-700">
                        <th className="px-6 py-3 text-left text-sm font-medium text-gray-900 dark:text-white">Permission</th>
                        <th className="px-6 py-3 text-center text-sm font-medium text-gray-900 dark:text-white">Admin</th>
                        <th className="px-6 py-3 text-center text-sm font-medium text-gray-900 dark:text-white">Member</th>
                        <th className="px-6 py-3 text-center text-sm font-medium text-gray-900 dark:text-white">Viewer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-zinc-700">
                      <tr>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">Create Projects</td>
                        <td className="px-6 py-4 text-center"><span className="text-green-600">✓</span></td>
                        <td className="px-6 py-4 text-center"><span className="text-green-600">✓</span></td>
                        <td className="px-6 py-4 text-center"><span className="text-red-600">✗</span></td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">Manage Members</td>
                        <td className="px-6 py-4 text-center"><span className="text-green-600">✓</span></td>
                        <td className="px-6 py-4 text-center"><span className="text-red-600">✗</span></td>
                        <td className="px-6 py-4 text-center"><span className="text-red-600">✗</span></td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">Edit Settings</td>
                        <td className="px-6 py-4 text-center"><span className="text-green-600">✓</span></td>
                        <td className="px-6 py-4 text-center"><span className="text-red-600">✗</span></td>
                        <td className="px-6 py-4 text-center"><span className="text-red-600">✗</span></td>
                      </tr>
                      <tr>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">View Analytics</td>
                        <td className="px-6 py-4 text-center"><span className="text-green-600">✓</span></td>
                        <td className="px-6 py-4 text-center"><span className="text-green-600">✓</span></td>
                        <td className="px-6 py-4 text-center"><span className="text-green-600">✓</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Team Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="font-medium text-gray-900 dark:text-white">Allow member invitations</label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Allow team members to invite others to join</p>
                    </div>
                    <input type="checkbox" defaultChecked className="rounded border-gray-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="font-medium text-gray-900 dark:text-white">Require email verification</label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">New members must verify their email address</p>
                    </div>
                    <input type="checkbox" defaultChecked className="rounded border-gray-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="font-medium text-gray-900 dark:text-white">Auto-assign projects</label>
                      <p className="text-sm text-gray-500 dark:text-gray-400">New members are automatically added to existing projects</p>
                    </div>
                    <input type="checkbox" className="rounded border-gray-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invite Member Dialog */}
      {showInviteDialog && (
        <div className="fixed inset-0 bg-black/20 dark:bg-black/50 backdrop-blur flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Invite Team Member</h2>
            <form onSubmit={handleInviteSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email Address</label>
                <input
                  type="email"
                  required
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter email address"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
                <select className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowInviteDialog(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Member Dialog */}
      {isEditing && (
        <div className="fixed inset-0 bg-black/20 dark:bg-black/50 backdrop-blur flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 rounded-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Edit Member</h2>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveMember(); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => { setIsEditing(false); setEditingMember(null); }}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamManagement;