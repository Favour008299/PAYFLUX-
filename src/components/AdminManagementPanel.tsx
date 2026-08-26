import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  ShieldAlert,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Mail,
  Calendar,
  AlertCircle,
  Crown
} from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext';
import {
  AdminUserRecord,
  fetchAllRegisteredAdmins,
  addNewAdmin,
  updateAdminStatus,
  PRIMARY_ADMIN_EMAIL
} from '../services/adminAuthService';

export const AdminManagementPanel: React.FC = () => {
  const { user, isSuperAdmin } = useAdminAuth();
  const [adminsList, setAdminsList] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [newEmail, setNewEmail] = useState<string>('');
  const [newRole, setNewRole] = useState<'superadmin' | 'admin'>('admin');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadAdmins = async () => {
    setLoading(true);
    try {
      const list = await fetchAllRegisteredAdmins();
      // Ensure primary owner is always displayed even if Firestore is seeding
      const hasPrimary = list.some((a) => a.email.toLowerCase() === PRIMARY_ADMIN_EMAIL);
      if (!hasPrimary) {
        list.unshift({
          uid: 'root_primary',
          email: PRIMARY_ADMIN_EMAIL,
          role: 'superadmin',
          name: 'PayFlux Owner',
          status: 'active',
          addedBy: 'System Root',
          addedAt: Date.now(),
        });
      }
      setAdminsList(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail || !user) return;

    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await addNewAdmin(newEmail, newRole, user);
      if (res.success) {
        setFeedback({ type: 'success', text: res.message });
        setNewEmail('');
        await loadAdmins();
      } else {
        setFeedback({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Failed to add admin.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (admin: AdminUserRecord) => {
    const nextStatus = admin.status === 'active' ? 'revoked' : 'active';
    try {
      const res = await updateAdminStatus(admin.uid, admin.email, nextStatus);
      if (res.success) {
        setFeedback({ type: 'success', text: `Admin ${admin.email} is now ${nextStatus}.` });
        await loadAdmins();
      } else {
        setFeedback({ type: 'error', text: res.message });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Update failed.' });
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 space-y-6 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white flex items-center gap-2">
              Expandable Admin Access Management
              <span className="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] uppercase font-bold tracking-wider">
                RBAC
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Grant and revoke administrative access for authorized PayFlux operations personnel.
            </p>
          </div>
        </div>

        <button
          onClick={loadAdmins}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold self-start transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-2xl flex items-center gap-2 text-xs ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Add New Admin Form (Visible to Super Admin) */}
      {isSuperAdmin && (
        <form
          onSubmit={handleAddAdmin}
          className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 space-y-3"
        >
          <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <UserPlus className="w-4 h-4 text-cyan-400" />
            <span>Authorize Additional Admin</span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative w-full sm:flex-1">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="newadmin@example.com"
                className="w-full bg-slate-900 border border-slate-800 focus:border-purple-500 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-slate-600 focus:outline-none"
              />
            </div>

            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as any)}
              className="w-full sm:w-36 bg-slate-900 border border-slate-800 focus:border-purple-500 rounded-xl py-2 px-3 text-xs text-white focus:outline-none font-medium"
            >
              <option value="admin">Admin</option>
              <option value="superadmin">Super Admin</option>
            </select>

            <button
              type="submit"
              disabled={isSubmitting || !newEmail}
              className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 hover:from-purple-500 hover:to-cyan-400 text-slate-950 font-bold text-xs shadow-md shadow-purple-950/40 disabled:opacity-50 transition-all shrink-0"
            >
              {isSubmitting ? 'Authorizing...' : 'Grant Access'}
            </button>
          </div>
        </form>
      )}

      {/* Admin List Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="pb-3 font-semibold">Admin Account</th>
              <th className="pb-3 font-semibold">Role</th>
              <th className="pb-3 font-semibold">Status</th>
              <th className="pb-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {adminsList.map((adm) => {
              const isPrimary = adm.email.toLowerCase() === PRIMARY_ADMIN_EMAIL;
              const isActive = adm.status === 'active';

              return (
                <tr key={adm.uid || adm.email} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3.5 pr-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[11px] ${
                        isPrimary
                          ? 'bg-gradient-to-tr from-amber-400 to-orange-500 text-slate-950 font-black'
                          : 'bg-slate-800 text-slate-300'
                      }`}>
                        {isPrimary ? <Crown className="w-4 h-4" /> : adm.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-white flex items-center gap-1.5">
                          {adm.email}
                          {isPrimary && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px] font-extrabold">
                              Owner
                            </span>
                          )}
                        </div>
                        {adm.addedBy && (
                          <div className="text-[10px] text-slate-500">Added by: {adm.addedBy}</div>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                      adm.role === 'superadmin'
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                    }`}>
                      <Shield className="w-3 h-3" />
                      {adm.role}
                    </span>
                  </td>

                  <td className="py-3.5 px-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isActive
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-rose-500/15 text-rose-300'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                      {isActive ? 'Active' : 'Revoked'}
                    </span>
                  </td>

                  <td className="py-3.5 pl-3 text-right">
                    {isPrimary ? (
                      <span className="text-[11px] text-slate-500 font-mono">Protected</span>
                    ) : isSuperAdmin ? (
                      <button
                        onClick={() => handleToggleStatus(adm)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                          isActive
                            ? 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30'
                            : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30'
                        }`}
                      >
                        {isActive ? 'Revoke Access' : 'Reactivate'}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-600">Restricted</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
