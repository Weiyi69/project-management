import React, { useState, useEffect } from 'react';
import {
  Settings,
  User,
  Shield,
  Bell,
  Save,
  Edit,
  Mail,
  Calendar,
  Smartphone,
  Lock,
  Eye,
  EyeOff,
  Globe,
  Clock,
  X,
  Check,
  AlertCircle
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
    role: 'Team Leader',
    department: 'SMD',
    status: 'Active'
  });
  const [notifications, setNotifications] = useState({
    email: true,
    push: false,
    projectUpdates: true,
    mentions: true,
    digest: false
  });

  // Modal states
  const [show2FAModal, setShow2FAModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);

  // 2FA state
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);

  // Password state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);

  // Sessions state
  const [activeSessions, setActiveSessions] = useState([
    {
      id: '1',
      device: 'Chrome on Windows',
      location: 'Manila, Philippines',
      ip: '192.168.1.100',
      lastActivity: '2 minutes ago',
      current: true,
      isCurrent: true
    },
    {
      id: '2',
      device: 'Safari on iPhone',
      location: 'Manila, Philippines',
      ip: '10.0.0.50',
      lastActivity: '1 hour ago',
      current: false,
      isCurrent: false
    },
    {
      id: '3',
      device: 'Firefox on Mac',
      location: 'New York, USA',
      ip: '203.0.113.1',
      lastActivity: '1 day ago',
      current: false,
      isCurrent: false
    }
  ]);

  // Load data on mount
  useEffect(() => {
    // Load notification preferences
    const savedNotifications = localStorage.getItem('userManagementNotifications');
    if (savedNotifications) {
      setNotifications(JSON.parse(savedNotifications));
    }
  }, []);

  // Auto-focus name input when entering edit mode - OPTION 2: Place cursor at end
  useEffect(() => {
    if (isEditing) {
      // Small timeout to ensure the DOM has updated
      setTimeout(() => {
        const nameInput = document.querySelector('input[type="text"][value="' + formData.name + '"]');
        if (nameInput) {
          nameInput.focus();
          // Place cursor at the end of the text
          const length = nameInput.value.length;
          nameInput.setSelectionRange(length, length);
        }
      }, 100);
    }
  }, [isEditing, formData.name]);

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
                      onClick={(e) => {
                        if (isEditing) {
                          e.target.focus();
                        }
                      }}
                      onFocus={(e) => {
                        if (isEditing) {
                          // Ensure the input is editable when focused
                          e.target.readOnly = false;
                        }
                      }}
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
                      <option value="Team Leader">Team Leader</option>
                      <option value="Member">Member</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Department</label>
                    <input
                      type="text"
                      value={formData.department}
                      disabled
                      className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                    />
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
                    <h4 className="font-medium text-gray-900 dark:text-white">Password</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Last changed 2 months ago</p>
                  </div>
                  <button
                    onClick={() => setShowPasswordModal(true)}
                    className="px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
                  >
                    Change Password
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 border border-gray-200 dark:border-zinc-700 rounded-lg">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">Active Sessions</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Manage your active sessions across all devices</p>
                  </div>
                  <button
                    onClick={() => setShowSessionsModal(true)}
                    className="px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
                  >
                    View Sessions
                  </button>
                </div>
              </div>
            </div>{/*  */}
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

  // Handle 2FA setup
  const handle2FASetup = () => {
    // Generate mock QR code URL and secret key
    const mockSecret = 'JBSWY3DPEHPK3PXP';
    const mockQRCode = `https://api.qrserver.com/v1/create-qr-code/?data=otpauth%3A%2F%2Ftotp%2FProjectManagement%3Fsecret%3D${mockSecret}%26issuer%3DProjectManagement`;

    setSecretKey(mockSecret);
    setQrCodeUrl(mockQRCode);
  };

  // Handle 2FA enable
  const handle2FAEnable = async (e) => {
    e.preventDefault();

    if (!totpCode || totpCode.length !== 6) {
      toast.error('Please enter a valid 6-digit code');
      return;
    }

    try {
      // Simulate 2FA verification
      await new Promise(resolve => setTimeout(resolve, 1000));

      setIs2FAEnabled(true);
      setShow2FAModal(false);
      setTotpCode('');
      toast.success('Two-Factor Authentication enabled successfully!');
    } catch (error) {
      toast.error('Invalid verification code. Please try again.');
    }
  };

  // Handle password validation
  const validatePassword = () => {
    const errors = {};

    if (!passwordForm.currentPassword) {
      errors.currentPassword = 'Current password is required';
    }

    if (!passwordForm.newPassword) {
      errors.newPassword = 'New password is required';
    } else if (passwordForm.newPassword.length < 8) {
      errors.newPassword = 'Password must be at least 8 characters long';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(passwordForm.newPassword)) {
      errors.newPassword = 'Password must contain at least one uppercase letter, one lowercase letter, and one number';
    }

    if (!passwordForm.confirmPassword) {
      errors.confirmPassword = 'Please confirm your new password';
    } else if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    setPasswordErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle password change
  const handlePasswordChange = async (e) => {
    e.preventDefault();

    if (!validatePassword()) {
      return;
    }

    try {
      // Simulate password change
      await new Promise(resolve => setTimeout(resolve, 1000));

      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setShowPasswordModal(false);
      setPasswordErrors({});
      toast.success('Password changed successfully!');
    } catch (error) {
      toast.error('Failed to change password. Please try again.');
    }
  };

  // Handle session termination
  const handleTerminateSession = (sessionId) => {
    setActiveSessions(prev => prev.filter(session => session.id !== sessionId));
    toast.success('Session terminated successfully');
  };

  // Handle terminate all other sessions
  const handleTerminateAllSessions = () => {
    setActiveSessions(prev => prev.filter(session => session.isCurrent));
    toast.success('All other sessions terminated');
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

      {/* 2FA Modal */}
      {show2FAModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-zinc-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Enable Two-Factor Authentication</h3>
              <button
                onClick={() => setShow2FAModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="text-sm text-gray-600 dark:text-gray-300 space-y-4">
                <p>1. Download an authenticator app like Google Authenticator or Authy on your mobile device.</p>
                <p>2. Scan the QR code below with your authenticator app.</p>
                <p>3. Enter the 6-digit code from your authenticator app to verify and enable 2FA.</p>
              </div>

              <div className="flex justify-center">
                <div className="bg-white p-4 rounded-lg border border-gray-200 dark:border-zinc-700">
                  {qrCodeUrl ? (
                    <img src={qrCodeUrl} alt="2FA QR Code" className="w-48 h-48" />
                  ) : (
                    <div className="w-48 h-48 bg-gray-100 dark:bg-zinc-700 rounded flex items-center justify-center">
                      <Smartphone size={48} className="text-gray-400 dark:text-gray-500" />
                    </div>
                  )}
                </div>
              </div>

              {secretKey && (
                <div className="bg-gray-50 dark:bg-zinc-700 p-4 rounded-lg">
                  <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">Manual setup key:</p>
                  <p className="font-mono text-sm bg-white dark:bg-zinc-800 p-2 rounded border border-gray-200 dark:border-zinc-600">{secretKey}</p>
                </div>
              )}

              <form onSubmit={handle2FAEnable} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Enter 6-digit code from your authenticator app
                  </label>
                  <input
                    type="text"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="000000"
                    maxLength={6}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShow2FAModal(false);
                      setTotpCode('');
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    onClick={handle2FASetup}
                  >
                    Verify & Enable
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-zinc-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Change Password</h3>
              <button
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                  setPasswordErrors({});
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={24} />
              </button>
            </div>

            <form onSubmit={handlePasswordChange} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Current Password</label>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {passwordErrors.currentPassword && (
                  <p className="text-red-500 text-sm mt-1">{passwordErrors.currentPassword}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  >
                    {showPassword ? <EyeOff size={20} className="text-gray-400" /> : <Eye size={20} className="text-gray-400" />}
                  </button>
                </div>
                {passwordErrors.newPassword && (
                  <p className="text-red-500 text-sm mt-1">{passwordErrors.newPassword}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Confirm New Password</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {passwordErrors.confirmPassword && (
                  <p className="text-red-500 text-sm mt-1">{passwordErrors.confirmPassword}</p>
                )}
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <h4 className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-2">Password Requirements:</h4>
                <ul className="text-sm text-blue-800 dark:text-blue-400 space-y-1">
                  <li>• At least 8 characters long</li>
                  <li>• Contains uppercase and lowercase letters</li>
                  <li>• Contains at least one number</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    setPasswordErrors({});
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Change Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sessions Modal */}
      {showSessionsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-zinc-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-zinc-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Active Sessions</h3>
              <button
                onClick={() => setShowSessionsModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-600 dark:text-gray-300">
                  You have {activeSessions.length} active session{activeSessions.length !== 1 ? 's' : ''}
                </div>
                <button
                  onClick={handleTerminateAllSessions}
                  className="text-red-600 hover:text-red-700 text-sm font-medium"
                >
                  Terminate All Other Sessions
                </button>
              </div>

              <div className="space-y-3">
                {activeSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-center justify-between p-4 border border-gray-200 dark:border-zinc-700 rounded-lg ${session.isCurrent ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'hover:bg-gray-50 dark:hover:bg-zinc-700'
                      }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gray-200 dark:bg-zinc-700 rounded-full flex items-center justify-center">
                        <Globe size={20} className="text-gray-600 dark:text-gray-300" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{session.device}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{session.location} • {session.ip}</div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">Last activity: {session.lastActivity}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {session.isCurrent && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300 text-xs rounded-full">
                          <Check size={12} />
                          Current
                        </span>
                      )}
                      {!session.isCurrent && (
                        <button
                          onClick={() => handleTerminateSession(session.id)}
                          className="px-3 py-1 text-red-600 hover:text-red-700 text-sm font-medium border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          Terminate
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle size={20} className="text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-yellow-800 dark:text-yellow-300">Security Tip</h4>
                    <p className="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
                      If you see a session you don't recognize, terminate it immediately and change your password.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowSessionsModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountSettings;