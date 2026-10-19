'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiRequestError } from '@/lib/api-client';
import { login } from '@/lib/auth';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/** Email/phone + password sign-in for the staff console. */
export function LoginForm() {
  const { t } = useT();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      const next = params.get('next');
      window.location.href = next && next.startsWith('/') ? next : '/';
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.status === 401
          ? t('auth.error.credentials')
          : t('error.network'),
      );
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <Card>
        <CardHeader>
          <CardTitle>{t('auth.login.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('staff.console.subtitle')}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="identifier" className="text-sm font-medium">
                {t('auth.identifier')}
              </label>
              <Input
                id="identifier"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={t('auth.identifier.placeholder')}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                {t('auth.password')}
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t('auth.working') : t('auth.signIn')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
