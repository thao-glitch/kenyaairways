'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { SitePhoto } from '@/components/media/site-photo';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError } from '@/lib/api-client';
import { login, register } from '@/lib/auth';

/** Shared sign-in / sign-up form; cookies are set cross-origin by the API. */
export function AuthForm({
  mode,
  next,
  banner,
}: {
  mode: 'login' | 'register';
  next?: string;
  /** Real photograph for the banner (resolved server-side from site settings). */
  banner: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = next && next.startsWith('/') ? next : '/pnr';

  function fail(err: unknown): void {
    if (err instanceof ApiRequestError) {
      if (err.code === 'UNAUTHENTICATED') {
        setError(t('auth.error.credentials'));
        return;
      }
      setError(err.message);
      return;
    }
    setError(t('error.network'));
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(identifier.trim(), password);
      } else {
        await register({
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          acceptTerms,
        });
      }
      router.push(target);
      router.refresh();
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }

  const toggleHref =
    mode === 'login'
      ? `/register${next ? `?next=${encodeURIComponent(next)}` : ''}`
      : `/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="mx-auto flex max-w-md flex-col gap-4">
      {/* Brand banner — a real photograph from the site's appearance settings */}
      <div className="overflow-hidden rounded-xl border">
        <SitePhoto src={banner} alt="" eager className="h-28 w-full" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">
          {mode === 'login' ? t('auth.login.title') : t('auth.register.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === 'login' ? t('auth.login.subtitle') : t('auth.register.subtitle')}
        </p>
      </div>

      {mode === 'login' ? (
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('auth.identifier')}
          <Input
            required
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={t('auth.identifier.placeholder')}
          />
        </label>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('auth.firstName')}
              <Input
                required
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('auth.lastName')}
              <Input
                required
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('auth.email')}
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('auth.phone')}
            <Input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+254712345678"
            />
            <span className="text-xs font-normal text-muted-foreground">
              {t('auth.phone.hint')}
            </span>
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('auth.password')}
        <Input
          required
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode === 'register' && (
          <span className="text-xs font-normal text-muted-foreground">
            {t('auth.password.hint')}
          </span>
        )}
      </label>

      {mode === 'register' && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            required
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>{t('auth.terms')}</span>
        </label>
      )}

      {error && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy}>
        {busy ? t('auth.working') : mode === 'login' ? t('auth.signIn') : t('auth.createAccount')}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
        <Link
          href={toggleHref}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {mode === 'login' ? t('nav.register') : t('nav.signIn')}
        </Link>
      </p>
    </form>
  );
}
