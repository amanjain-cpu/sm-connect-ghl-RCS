import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { adminApi } from '@/stores/admin.store';
import { notify } from '@/stores/notification.store';

export function AdminInviteAcceptPage() {
  const navigate = useNavigate();
  const { token } = useParams();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAccept = async () => {
    if (!token) {
      notify.error('Invite missing', 'The invite token is missing from the URL.');
      return;
    }

    if (password.length < 12) {
      notify.error('Password too short', 'Use at least 12 characters for the admin password.');
      return;
    }

    if (password !== confirmPassword) {
      notify.error('Passwords do not match', 'Re-enter the same password in both fields.');
      return;
    }

    setIsSubmitting(true);
    try {
      await adminApi.acceptAdminInvite(token, {
        password,
        name: name.trim() || undefined,
      });
      notify.success('Admin account created', 'Sign in with your email and new password.');
      navigate('/admin/login');
    } catch (error) {
      notify.error('Invite failed', error instanceof Error ? error.message : 'Could not accept this invite.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 dark:bg-slate-950">
      <Card className="w-full max-w-md border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <CardContent className="space-y-5 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-slate-950 p-3 text-white dark:bg-slate-100 dark:text-slate-950">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">Accept Admin Invite</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">Create your app-level admin password.</p>
            </div>
          </div>

          <div className="space-y-3">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="Password"
              leftIcon={<KeyRound className="h-4 w-4" />}
            />
            <Input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              placeholder="Confirm password"
              leftIcon={<KeyRound className="h-4 w-4" />}
            />
          </div>

          <Button className="w-full" onClick={handleAccept} isLoading={isSubmitting}>
            Create Admin Account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
