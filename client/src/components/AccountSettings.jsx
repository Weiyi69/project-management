import React, { useState, useEffect } from 'react';
import {
  Settings,
  User,
  Shield,
  Bell,
  Save,
  Edit,
  Mail,
  Calendar
} from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import { toast } from 'react-hot-toast';
import { useUser } from '@clerk/clerk-react';
import ExportDropdown from './ExportDropdown';

const AccountSettings = () => {
  const dispatch = useDispatch();
  const { user } = useUser();
  const { currentWorkspace, workspaces } = useSelector((state) => state.workspace);

  // State management
  const [activeTab, setActiveTab] = useState('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.fullName || '',
    email: user?.emailAddresses[0]?.emailAddress || '',
    role: 'Admin',
    department: 'Engineering',
    status: 'Active'
  });
  const [notifications, setNotifications] = useState({
    email: true,
    push: false,
    projectUpdates: true,
    taskAssignments: true,
    mentions: true,
    digest: false
  });

  // Load data on mount
  useEffect(() => {
    // Load notification preferences
    const savedNotifications = localStorage.getItem('userManagementNotifications');
    if (savedNotifications) {
      setNotifications(JSON.parse(savedNotifications));
    }
  }, []);

  // Handle form updates
  const handleProfileUpdate = async (e) => {
    e.preventDefault();

    try {
      if (formData.name !== user?.fullName) {
        await user?.update({
          firstName: formData.name.split(' ')[0],
          lastName: formData.name.split(' ').slice(1).join(' ')
        });
      }

      toast.success('Profile updated successfully!');
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile. Please try again.');
    }
  };


  const handleNotificationsUpdate = (e) => {
    e.preventDefault();

    try {
      localStorage.setItem('userManagementNotifications', JSON.stringify(notifications));
      toast.success('Notification preferences saved!');
    } catch (error) {
      console.error('Error saving notification settings:', error);
      toast.error('Failed to save notification settings.');
    }
  };


  const tabs = [
    { id: 'profile', name: 'Profile', icon: User },
    { id: 'security', name: 'Security', icon: Shield },
    { id: 'notifications', name: 'Notifications', icon: Bell }
  ];

  // Generate export data based on current tab
  const getExportData = () => {
    switch (activeTab) {
      case 'profile':
        return [{
          name: formData.name,
          email: formData.email,
          role: formData.role,
          department: formData.department,
          status: formData.status
        }];
      
      case 'security':
        return [{
          feature: 'Two-Factor Authentication',
          status: 'Not Enabled',
          lastPasswordChange: '2 months ago'
        }, {
          feature: 'Active Sessions',
          status: 'Multiple devices',
          lastActivity: 'Today'
        }];
      
      case 'notifications':
        return [{
          category: 'Email Notifications',
          projectUpdates: notifications.projectUpdates ? 'Enabled' : 'Disabled',
          taskAssignments: notifications.taskAssignments ? 'Enabled' : 'Disabled',
          mentions: notifications.mentions ? 'Enabled' : 'Disabled'
        }, {
          category: 'Other Settings',
          pushNotifications: notifications.push ? 'Enabled' : 'Disabled',
          emailDigest: notifications.digest ? 'Enabled' : 'Disabled'
        }];
      
      default:
        return [];
    }
  };

  // Get filename based on current tab
  const getExportFilename = () => {
    const tabName = tabs.find(tab => tab.id === activeTab)?.name || 'AccountSettings';
    return `${tabName}_Data_${new Date().toISOString().slice(0, 10)}`;
  };

  const TabContent = () => {
    switch (activeTab) {
      case 'profile':
        return (
          <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Profile Information</h3>
                <button
                  onClick={() => setIsEditing(!isEditing)}
                  className="flex items-center gap-2 px-4 py-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                >
                  <Edit size={18} />
                  {isEditing ? 'Cancel' : 'Edit'}
                </button>
              </div>

              <form onSubmit={handleProfileUpdate} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Full Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      disabled={!isEditing}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-zinc-800 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Email Address</label>
                    <input
                      type="email"
                      value={formData.email}
                      disabled
                      className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Role</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      disabled={!isEditing}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-zinc-800 disabled:cursor-not-allowed"
                    >
                      <option value="Admin">Admin</option>
                      <option value="Member">Member</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
                    <select
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      disabled={!isEditing}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-zinc-800 disabled:cursor-not-allowed"
                    >
                      <option value="SDD">SDD</option>
                      <option value="NMD">NMD</option>
                      <option value="ITSD">ITSD</option>
                      <option value="SMD">SMD</option>
                      <option value="CYBERSECURITY">CYBERSECURITY</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
                    <input
                      type="text"
                      value={formData.status}
                      disabled
                      className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                    />
                  </div>
                </div>

                {isEditing && (
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <Save size={18} />
                      Save Changes
                    </button>
                  </div>
                )}
              </form>
            </div>
          </div>
        );


      case 'security':
        return (
          <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Security Settings</h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-zinc-700 rounded-lg">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Two-Factor Authentication</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Add an extra layer of security to your account</p>
                  </div>
                  <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    Enable 2FA
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-zinc-700 rounded-lg">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Password</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Last changed 2 months ago</p>
                  </div>
                  <button className="px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                    Change Password
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-zinc-700 rounded-lg">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Active Sessions</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Manage your active sessions across all devices</p>
                  </div>
                  <button className="px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                    View Sessions
                  </button>
                </div>
              </div>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-6">
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-gray-200 dark:border-zinc-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Notification Preferences</h3>

              <form onSubmit={handleNotificationsUpdate} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900 dark:text-white">Email Notifications</h4>

                    <label className="flex items-center justify-between p-3 border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                      <div className="flex items-center gap-3">
                        <Mail size={18} className="text-gray-500 dark:text-gray-400" />
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">Project Updates</span>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Get notified about project changes</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.projectUpdates}
                        onChange={(e) => setNotifications({ ...notifications, projectUpdates: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                    </label>

                    <label className="flex items-center justify-between p-3 border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                      <div className="flex items-center gap-3">
                        <Calendar size={18} className="text-gray-500 dark:text-gray-400" />
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">Task Assignments</span>
                          <p className="text-sm text-gray-500 dark:text-gray-400">When tasks are assigned to you</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.taskAssignments}
                        onChange={(e) => setNotifications({ ...notifications, taskAssignments: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                    </label>

                    <label className="flex items-center justify-between p-3 border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                      <div className="flex items-center gap-3">
                        <Edit size={18} className="text-gray-500 dark:text-gray-400" />
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">Mentions</span>
                          <p className="text-sm text-gray-500 dark:text-gray-400">When you're mentioned in comments</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.mentions}
                        onChange={(e) => setNotifications({ ...notifications, mentions: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                    </label>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900 dark:text-white">Other Settings</h4>

                    <label className="flex items-center justify-between p-3 border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                      <div className="flex items-center gap-3">
                        <Bell size={18} className="text-gray-500 dark:text-gray-400" />
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">Push Notifications</span>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Browser notifications</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.push}
                        onChange={(e) => setNotifications({ ...notifications, push: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                    </label>

                    <label className="flex items-center justify-between p-3 border border-gray-200 dark:border-zinc-700 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors">
                      <div className="flex items-center gap-3">
                        <Settings size={18} className="text-gray-500 dark:text-gray-400" />
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">Email Digest</span>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Weekly summary email</p>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={notifications.digest}
                        onChange={(e) => setNotifications({ ...notifications, digest: e.target.checked })}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
                      />
                    </label>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Save size={18} />
                    Save Preferences
                  </button>
                </div>
              </form>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-white">
      {/* Header */}
      <div className="bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings size={24} className="text-blue-600 dark:text-blue-400" />
            <h1 className="text-2xl font-bold">Account Settings</h1>
          </div>
          <ExportDropdown 
            data={getExportData()} 
            filename={getExportFilename()}
          />
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

          {/* Tab Content */}
          <TabContent />
        </div>
      </div>
    </div>
  );
};

export default AccountSettings;
