import { useEffect, useState } from 'react';
import { Copy, KeyRound, RefreshCcw, Send, ShieldOff, UserPlus } from 'lucide-react';
import { AdminHeader } from '@/components/layout/admin-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminApi } from '@/stores/admin.store';
import { notify } from '@/stores/notification.store';
import { formatDate } from '@/lib/utils';

interface AdminUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  deactivatedAt: string | null;
  createdAt: string;
  _count?: {
    refreshTokens: number;
  };
}

interface AdminInvite {
  id: string;
  email: string;
  name: string | null;
  expiresAt: string;
  createdAt: string;
  createdByAdmin?: {
    email: string;
    name?: string | null;
  };
}

export function AdminUsersPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [createdInviteUrl, setCreatedInviteUrl] = useState('');
  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
  });

  const loadAdminUsers = async () => {
    setIsLoading(true);
    try {
      const response = await adminApi.getAdminUsers();
      if (response.success) {
        setAdmins(response.data.admins);
        setInvites(response.data.invites);
      }
    } catch (error) {
      notify.error('Admin users failed to load', error instanceof Error ? error.message : 'Could not load admin users.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAdminUsers();
  }, []);

  const handleCreateInvite = async () => {
    if (!inviteForm.email.trim()) {
      notify.error('Email required', 'Enter an admin email before creating an invite.');
      return;
    }

    setIsCreatingInvite(true);
    try {
      const response = await adminApi.createAdminInvite({
        email: inviteForm.email.trim(),
        name: inviteForm.name.trim() || undefined,
      });
      if (response.success) {
        setCreatedInviteUrl(response.data.inviteUrl);
        setInviteForm({ email: '', name: '' });
        await loadAdminUsers();
        notify.success('Invite created', 'Share the one-time invite URL with the admin.');
      }
    } catch (error) {
      notify.error('Invite failed', error instanceof Error ? error.message : 'Could not create admin invite.');
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!createdInviteUrl) return;
    await navigator.clipboard.writeText(createdInviteUrl);
    notify.success('Invite copied', 'The one-time invite URL is on your clipboard.');
  };

  const handleResetPassword = async (admin: AdminUser) => {
    const temporaryPassword = window.prompt(`Temporary password for ${admin.email}`);
    if (!temporaryPassword?.trim()) {
      return;
    }

    setActiveAction(`reset:${admin.id}`);
    try {
      await adminApi.resetAdminPassword(admin.id, temporaryPassword.trim());
      await loadAdminUsers();
      notify.success('Password reset', 'Refresh tokens were revoked and the admin must change password on next login.');
    } catch (error) {
      notify.error('Reset failed', error instanceof Error ? error.message : 'Could not reset admin password.');
    } finally {
      setActiveAction(null);
    }
  };

  const handleDeactivate = async (admin: AdminUser) => {
    if (!window.confirm(`Deactivate ${admin.email}? Existing refresh tokens will be revoked.`)) {
      return;
    }

    setActiveAction(`deactivate:${admin.id}`);
    try {
      await adminApi.deactivateAdmin(admin.id);
      await loadAdminUsers();
      notify.success('Admin deactivated', 'The admin account can no longer sign in.');
    } catch (error) {
      notify.error('Deactivate failed', error instanceof Error ? error.message : 'Could not deactivate admin.');
    } finally {
      setActiveAction(null);
    }
  };

  const handleRevokeInvite = async (invite: AdminInvite) => {
    setActiveAction(`revoke:${invite.id}`);
    try {
      await adminApi.revokeAdminInvite(invite.id);
      await loadAdminUsers();
      notify.success('Invite revoked', 'The one-time invite URL can no longer be accepted.');
    } catch (error) {
      notify.error('Revoke failed', error instanceof Error ? error.message : 'Could not revoke invite.');
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <AdminHeader title="Admin Users" subtitle="Invite admins and manage app-level access" showBack />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                <UserPlus className="h-5 w-5 text-slate-700 dark:text-slate-200" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Create Invite</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">SMTP is not wired; share the generated one-time URL manually.</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Input
                value={inviteForm.email}
                onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })}
                placeholder="admin@example.com"
              />
              <Input
                value={inviteForm.name}
                onChange={(event) => setInviteForm({ ...inviteForm, name: event.target.value })}
                placeholder="Name"
              />
              <Button onClick={handleCreateInvite} isLoading={isCreatingInvite}>
                <Send className="mr-2 h-4 w-4" />
                Create
              </Button>
            </div>

            {createdInviteUrl && (
              <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 md:flex-row md:items-center dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                <span className="min-w-0 flex-1 break-all">{createdInviteUrl}</span>
                <Button size="sm" variant="outline" onClick={handleCopyInvite}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Admins</h2>
            <Button variant="outline" size="sm" onClick={loadAdminUsers}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>

          {isLoading ? (
            <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <CardContent className="p-6 text-sm text-slate-600 dark:text-slate-400">Loading admins...</CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {admins.map((admin) => (
                <Card key={admin.id} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-950 dark:text-slate-50">{admin.name || admin.email}</h3>
                        <Badge variant={admin.isActive ? 'success' : 'secondary'}>{admin.isActive ? 'Active' : 'Inactive'}</Badge>
                        {admin.mustChangePassword && <Badge variant="warning">Must change password</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{admin.email}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                        Last login: {admin.lastLoginAt ? formatDate(admin.lastLoginAt) : 'Never'} · Active sessions: {admin._count?.refreshTokens ?? 0}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResetPassword(admin)}
                        disabled={!admin.isActive}
                        isLoading={activeAction === `reset:${admin.id}`}
                      >
                        <KeyRound className="mr-2 h-4 w-4" />
                        Reset
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeactivate(admin)}
                        disabled={!admin.isActive}
                        isLoading={activeAction === `deactivate:${admin.id}`}
                      >
                        <ShieldOff className="mr-2 h-4 w-4" />
                        Deactivate
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-50">Pending Invites</h2>
          <div className="grid gap-3">
            {invites.length === 0 ? (
              <Card className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                <CardContent className="p-6 text-sm text-slate-600 dark:text-slate-400">No pending invites.</CardContent>
              </Card>
            ) : (
              invites.map((invite) => (
                <Card key={invite.id} className="border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                  <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="font-semibold text-slate-950 dark:text-slate-50">{invite.name || invite.email}</h3>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{invite.email}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">Expires {formatDate(invite.expiresAt)}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevokeInvite(invite)}
                      isLoading={activeAction === `revoke:${invite.id}`}
                    >
                      Revoke
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
