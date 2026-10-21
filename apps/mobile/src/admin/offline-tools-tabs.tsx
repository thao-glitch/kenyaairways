/**
 * The five offline-tool tabs: Overview, Flights+prices, Bookings,
 * Payments+verify and Site settings — all served by the on-device engine
 * through the `env.call` helper (same paths/DTOs as the server).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type {
  AdminFlightPriceDto,
  AdminBookingSummaryDto,
  LoadReportDto,
  MpesaVerifyCheckDto,
  MpesaManualVerificationDto,
  RevenueReportDto,
  SiteSettingsDto,
} from '@kenyaairways/shared';
import { Badge, Button, Card, EmptyState, Loading } from '@/components/ui';
import { colors, radii, spacing, type } from '@/theme/tokens';
import type { ToolsEnv } from './offline-tools';

export type LocalCall = <T = unknown>(
  method: string,
  path: string,
  opts?: { query?: Record<string, string>; body?: unknown },
) => T;

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radii.sm,
  padding: spacing.sm,
  color: colors.foreground,
  backgroundColor: colors.card,
} as const;

function useLocal<T>(env: ToolsEnv, path: string, query?: Record<string, string>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    try {
      const result = env.call<T>('GET', path, { query });
      if (alive) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (alive) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (alive) setLoading(false);
    }
    return () => {
      alive = false;
    };
  }, [env.call, path, JSON.stringify(query ?? {}), nonce]);

  return { data, error, loading, refresh };
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text style={{ ...type.caption, color: colors.destructive, marginBottom: spacing.sm }}>
      {message}
    </Text>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
      <Text style={{ ...type.caption, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ ...type.body, color: colors.foreground, fontWeight: '600' }}>{value}</Text>
    </View>
  );
}

const kes = (minor: number) => `${(minor / 100).toLocaleString('en-US')} KES`;

// ── overview ────────────────────────────────────────────────────────────────

export function OverviewTab({ env }: { env: ToolsEnv }) {
  const revenue = useLocal<RevenueReportDto>(env, '/api/v1/reports/revenue');
  const load = useLocal<LoadReportDto>(env, '/api/v1/reports/load');

  return (
    <View>
      <ErrorNote message={revenue.error ?? load.error} />
      <Card>
        <Text style={{ ...type.title, color: colors.foreground, marginBottom: spacing.sm }}>
          {env.t('revenue30')}
        </Text>
        {revenue.loading ? (
          <Loading label="" />
        ) : revenue.data ? (
          <>
            <Row label={env.t('gross')} value={kes(revenue.data.totals.grossMinor)} />
            <Row label={env.t('net')} value={kes(revenue.data.totals.netMinor)} />
            <Row label={env.t('paymentsCount')} value={String(revenue.data.totals.payments)} />
          </>
        ) : (
          <EmptyState title={env.t('noData')} />
        )}
      </Card>
      <Card>
        <Text style={{ ...type.title, color: colors.foreground, marginBottom: spacing.sm }}>
          {env.t('load7')}
        </Text>
        {load.loading ? (
          <Loading label="" />
        ) : load.data ? (
          <>
            <Row label={env.t('flightsCount')} value={String(load.data.totals.flights)} />
            <Row label={env.t('seatsSold')} value={String(load.data.totals.seatsSold)} />
            <Row label={env.t('capacity')} value={String(load.data.totals.capacity)} />
            <Row
              label="Load"
              value={
                load.data.totals.loadFactorPct === null ? '—' : `${load.data.totals.loadFactorPct}%`
              }
            />
          </>
        ) : (
          <EmptyState title={env.t('noData')} />
        )}
      </Card>
    </View>
  );
}

// ── flights + prices ────────────────────────────────────────────────────────

export function FlightsTab({ env }: { env: ToolsEnv }) {
  const [origin, setOrigin] = useState('NBO');
  const [filter, setFilter] = useState<{ origin?: string }>({ origin: 'NBO' });
  const flights = useLocal<AdminFlightPriceDto[]>(env, '/api/v1/admin/flights', {
    origin: filter.origin ?? '',
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(flightId: string, fareClassCode: string) {
    setBusy(true);
    setNote(null);
    try {
      const minor = Math.round(Number(draft.replace(/[^\d.]/g, '')) * 100);
      if (!Number.isFinite(minor) || minor <= 0) throw new Error(env.t('saveFailed'));
      env.call('PATCH', `/api/v1/admin/flights/${flightId}/fares`, {
        body: { fares: [{ fareClassCode, baseFareMinor: minor }] },
      });
      setNote({ ok: true, text: env.t('saved') });
      setEditing(null);
      flights.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : env.t('saveFailed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.sm }}>
        {env.t('flightsHint')}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <TextInput
          value={origin}
          onChangeText={setOrigin}
          autoCapitalize="characters"
          placeholder={env.t('routeFilter')}
          placeholderTextColor={colors.mutedForeground}
          style={[inputStyle, { flex: 1 }]}
        />
        <View style={{ width: 96 }}>
          <Button
            title={env.t('search')}
            variant="secondary"
            onPress={() => setFilter({ origin: origin.trim().toUpperCase() || undefined })}
          />
        </View>
      </View>
      <ErrorNote message={flights.error} />
      {note ? (
        <Text
          style={{
            ...type.caption,
            color: note.ok ? colors.success : colors.destructive,
            marginBottom: spacing.sm,
          }}
        >
          {note.text}
        </Text>
      ) : null}
      {flights.loading ? (
        <Loading label="" />
      ) : (flights.data ?? []).length === 0 ? (
        <EmptyState title={env.t('noFlights')} />
      ) : (
        (flights.data ?? []).slice(0, 25).map((f) => (
          <Card key={f.flightId}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...type.title, color: colors.foreground }}>{f.flightNumber}</Text>
              <Badge label={f.status} tone={f.status === 'SCHEDULED' ? 'success' : 'warning'} />
            </View>
            <Text style={{ ...type.caption, color: colors.mutedForeground }}>
              {f.originCode} → {f.destinationCode} · {f.flightDate} ·{' '}
              {f.departureLocal.slice(11, 16)}
            </Text>
            {f.fares.map((fare) => {
              const key = `${f.flightId}:${fare.fareClassCode}`;
              return (
                <View
                  key={key}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: spacing.sm,
                    gap: spacing.sm,
                  }}
                >
                  <Text
                    style={{ ...type.body, color: colors.foreground, width: 74, fontWeight: '600' }}
                  >
                    {fare.fareClassCode}
                  </Text>
                  {editing === key ? (
                    <>
                      <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        keyboardType="numeric"
                        style={[inputStyle, { flex: 1 }]}
                      />
                      <View style={{ width: 70 }}>
                        <Button
                          title={env.t('save')}
                          loading={busy}
                          onPress={() => void save(f.flightId, fare.fareClassCode)}
                        />
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={{ ...type.body, color: colors.foreground, flex: 1 }}>
                        {kes(fare.baseFareMinor)}
                      </Text>
                      <Pressable
                        onPress={() => {
                          setEditing(key);
                          setDraft((fare.baseFareMinor / 100).toFixed(2));
                        }}
                      >
                        <Text style={{ ...type.caption, color: colors.primary, fontWeight: '600' }}>
                          {env.t('basePrice')}
                        </Text>
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })}
          </Card>
        ))
      )}
    </View>
  );
}

// ── bookings ────────────────────────────────────────────────────────────────

export function BookingsTab({ env }: { env: ToolsEnv }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState<string | undefined>(undefined);
  const bookings = useLocal<AdminBookingSummaryDto[]>(env, '/api/v1/admin/bookings', {
    q: query ?? '',
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function recordPay(booking: AdminBookingSummaryDto) {
    setBusyId(booking.id);
    setNote(null);
    try {
      env.call('POST', `/api/v1/admin/bookings/${booking.id}/pay`, {
        body: { provider: 'CASH', amountMinor: booking.totalMinor, reference: 'COUNTER' },
      });
      setNote({ ok: true, text: env.t('recorded') });
      bookings.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : env.t('recordFailed') });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.sm }}>
        {env.t('bookingsHint')}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={env.t('searchBookings')}
          placeholderTextColor={colors.mutedForeground}
          style={[inputStyle, { flex: 1 }]}
        />
        <View style={{ width: 96 }}>
          <Button
            title={env.t('search')}
            variant="secondary"
            onPress={() => setQuery(q.trim() || undefined)}
          />
        </View>
      </View>
      <ErrorNote message={bookings.error} />
      {note ? (
        <Text
          style={{
            ...type.caption,
            color: note.ok ? colors.success : colors.destructive,
            marginBottom: spacing.sm,
          }}
        >
          {note.text}
        </Text>
      ) : null}
      {bookings.loading ? (
        <Loading label="" />
      ) : (bookings.data ?? []).length === 0 ? (
        <EmptyState title={env.t('noBookings')} />
      ) : (
        (bookings.data ?? []).map((b) => (
          <Card key={b.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...type.title, color: colors.foreground }}>{b.pnr}</Text>
              <Badge
                label={b.paid ? env.t('paid') : env.t('unpaid')}
                tone={b.paid ? 'success' : 'warning'}
              />
            </View>
            <Text style={{ ...type.caption, color: colors.mutedForeground }}>
              {b.route} · {b.flightNumbers.join(', ')}
            </Text>
            <Row label={b.passengerNames.join(', ') || '—'} value={kes(b.totalMinor)} />
            {!b.paid ? (
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  title={env.t('recordPayment')}
                  loading={busyId === b.id}
                  onPress={() => void recordPay(b)}
                />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </View>
  );
}

// ── payments + verify ───────────────────────────────────────────────────────

export function PaymentsTab({ env }: { env: ToolsEnv }) {
  const records = useLocal<{ items: MpesaManualVerificationDto[] }>(
    env,
    '/api/v1/admin/mpesa-verifier/records',
  );
  const [message, setMessage] = useState('');
  const [check, setCheck] = useState<MpesaVerifyCheckDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const site = useLocal<SiteSettingsDto>(env, '/api/v1/site-settings');

  async function parse() {
    setBusy(true);
    setNote(null);
    try {
      const res = env.call<MpesaVerifyCheckDto>('POST', '/api/v1/admin/mpesa-verifier/parse', {
        body: { message },
      });
      setCheck(res);
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : env.t('verifyFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setNote(null);
    try {
      env.call('POST', '/api/v1/admin/mpesa-verifier/verify', { body: { message } });
      setNote({ ok: true, text: env.t('verified') });
      setCheck(null);
      setMessage('');
      records.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : env.t('verifyFailed') });
    } finally {
      setBusy(false);
    }
  }

  async function confirmRecord(id: string) {
    setNote(null);
    try {
      env.call('POST', `/api/v1/admin/mpesa-verifier/records/${id}/confirm`, { body: {} });
      setNote({ ok: true, text: env.t('confirmed') });
      records.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : env.t('genericError') });
    }
  }

  async function rejectRecord(id: string) {
    setNote(null);
    try {
      env.call('POST', `/api/v1/admin/mpesa-verifier/records/${id}/reject`, {
        body: { reason: 'Rejected from offline tools' },
      });
      setNote({ ok: true, text: env.t('rejected') });
      records.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : env.t('genericError') });
    }
  }

  return (
    <View>
      <Card>
        <Text style={{ ...type.title, color: colors.foreground, marginBottom: spacing.xs }}>
          {env.t('paymentsTitle')}
        </Text>
        <Text style={{ ...type.caption, color: colors.mutedForeground }}>
          {env.t('paymentsHint')}
        </Text>
        {site.data?.mpesaPaybill ? (
          <Row label={env.t('paymentNumber')} value={site.data.mpesaPaybill} />
        ) : null}
        <TextInput
          value={message}
          onChangeText={setMessage}
          multiline
          placeholder="SJH4LMOP32 confirmed. Ksh1,500.00 sent to ACCOUNT 0182774255 …"
          placeholderTextColor={colors.mutedForeground}
          style={[inputStyle, { minHeight: 84, marginTop: spacing.sm, textAlignVertical: 'top' }]}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              title={env.t('parse')}
              variant="secondary"
              loading={busy}
              onPress={() => void parse()}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={env.t('verify')} loading={busy} onPress={() => void verify()} />
          </View>
        </View>
        {check ? (
          <View style={{ marginTop: spacing.sm }}>
            {check.parsed.receiptNumber ? (
              <Row label={env.t('receipt')} value={check.parsed.receiptNumber} />
            ) : null}
            {check.parsed.amountMinor !== null ? (
              <Row label={env.t('amount')} value={kes(check.parsed.amountMinor)} />
            ) : null}
            {check.pnr ? <Row label="PNR" value={check.pnr} /> : null}
            {check.issues.length > 0 ? (
              <Text style={{ ...type.caption, color: colors.warning, marginTop: spacing.xs }}>
                {env.t('issues')}: {check.issues.join(' · ')}
              </Text>
            ) : null}
          </View>
        ) : null}
        <ErrorNote message={note && !note.ok ? note.text : null} />
        {note?.ok ? (
          <Text style={{ ...type.caption, color: colors.success, marginTop: spacing.xs }}>
            {note.text}
          </Text>
        ) : null}
      </Card>

      <Text
        style={{
          ...type.title,
          color: colors.foreground,
          marginTop: spacing.md,
          marginBottom: spacing.sm,
        }}
      >
        {env.t('records')}
      </Text>
      {records.loading ? (
        <Loading label="" />
      ) : (records.data?.items ?? []).length === 0 ? (
        <EmptyState title={env.t('noRecords')} />
      ) : (
        (records.data?.items ?? []).map((r) => (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...type.body, color: colors.foreground, fontWeight: '600' }}>
                {r.receiptNumber}
              </Text>
              <Badge
                label={r.status}
                tone={
                  r.status === 'CONFIRMED'
                    ? 'success'
                    : r.status === 'REJECTED'
                      ? 'danger'
                      : 'warning'
                }
              />
            </View>
            <Row label={env.t('amount')} value={kes(r.amountMinor)} />
            {r.pnr ? <Row label="PNR" value={r.pnr} /> : null}
            {r.status === 'PENDING' ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title={env.t('confirm')} onPress={() => void confirmRecord(r.id)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title={env.t('reject')}
                    variant="secondary"
                    onPress={() => void rejectRecord(r.id)}
                  />
                </View>
              </View>
            ) : null}
          </Card>
        ))
      )}
    </View>
  );
}

// ── site settings ───────────────────────────────────────────────────────────

const THEMES = ['sky', 'savanna', 'ocean', 'forest', 'midnight', 'crimson'] as const;

export function SettingsTab({ env }: { env: ToolsEnv }) {
  const site = useLocal<SiteSettingsDto>(env, '/api/v1/site-settings');
  const [appName, setAppName] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (site.data && appName === null) {
      setAppName(site.data.appName);
      setTheme(site.data.theme);
    }
  }, [site.data, appName]);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const updated = env.call<SiteSettingsDto>('PATCH', '/api/v1/admin/site-settings', {
        body: { appName: appName ?? undefined, theme: theme ?? undefined },
      });
      setAppName(updated.appName);
      setTheme(updated.theme);
      setNote({ ok: true, text: env.t('savedSettings') });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : env.t('settingsFailed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text style={{ ...type.title, color: colors.foreground, marginBottom: spacing.sm }}>
        {env.t('settingsTitle')}
      </Text>
      <ErrorNote message={site.error} />
      <Text style={{ ...type.caption, color: colors.mutedForeground }}>{env.t('appName')}</Text>
      <TextInput
        value={appName ?? ''}
        onChangeText={setAppName}
        maxLength={40}
        style={[inputStyle, { marginBottom: spacing.md }]}
      />
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.xs }}>
        {env.t('theme')}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
      >
        {THEMES.map((name) => (
          <Pressable
            key={name}
            onPress={() => setTheme(name)}
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: radii.sm,
              backgroundColor: theme === name ? colors.primary : colors.secondary,
            }}
          >
            <Text
              style={{
                ...type.caption,
                fontWeight: '600',
                color: theme === name ? colors.primaryForeground : colors.foreground,
              }}
            >
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
      {site.data?.mpesaPaybill ? (
        <Row label={env.t('paymentNumber')} value={site.data.mpesaPaybill} />
      ) : null}
      <View style={{ marginTop: spacing.md }}>
        <Button title={env.t('save')} loading={busy} onPress={() => void save()} />
      </View>
      {note?.ok ? (
        <Text style={{ ...type.caption, color: colors.success, marginTop: spacing.sm }}>
          {note.text}
        </Text>
      ) : null}
      {note && !note.ok ? (
        <Text style={{ ...type.caption, color: colors.destructive, marginTop: spacing.sm }}>
          {note.text}
        </Text>
      ) : null}
    </Card>
  );
}
