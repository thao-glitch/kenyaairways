/**
 * Payment — the missing step in the native traveller funnel.
 *
 * A booking stays HELD until money arrives. The primary path is the same
 * paybill flow the website uses: show the paybill number, PNR and amount,
 * let the passenger pay from their phone, then paste the confirmation SMS —
 * verified on-device/at the API and the booking confirms on the spot. STK
 * push stays available as an opt-in alternative; mock mode can deliver a
 * simulated result so demos never wait on Daraja.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, Pressable } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { PaymentDto, MpesaManualVerificationDto, SiteSettingsDto } from '@kenyaairways/shared';
import { useBooking } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, Loading, Screen } from '@/components/ui';
import { colors, radii, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'Payment'>;

const ACTIVE: readonly string[] = ['REQUIRES_ACTION', 'PENDING'];

function money(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function paymentTone(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'PAID') return 'success';
  if (status === 'FAILED' || status === 'EXPIRED') return 'danger';
  return 'warning';
}

export function PaymentScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const queryClient = useQueryClient();
  const { data: booking, isLoading } = useBooking(params.bookingId);

  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [site, setSite] = useState<SiteSettingsDto | null>(null);
  const [verify, setVerify] = useState<MpesaManualVerificationDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [msisdn, setMsisdn] = useState('');
  const [showStk, setShowStk] = useState(false);

  const payment = useMemo(() => {
    const sorted = payments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return sorted[0] ?? null;
  }, [payments]);

  const active = payment ? ACTIVE.includes(payment.status) : false;
  const bookingConfirmed =
    booking?.status === 'CONFIRMED' ||
    booking?.status === 'CHECKED_IN' ||
    payment?.status === 'PAID';

  const refreshPayments = useCallback(async () => {
    try {
      const list = await api.get<PaymentDto[]>('/api/v1/payments', {
        bookingId: params.bookingId,
      });
      setPayments(list);
    } catch {
      /* the booking itself still renders; retry happens on the next action */
    }
  }, [params.bookingId]);

  const refreshBooking = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['booking', params.bookingId] });
    void queryClient.invalidateQueries({ queryKey: ['bookings'] });
  }, [params.bookingId, queryClient]);

  // Check-in requires an issued ticket per passenger. The API leaves ticketing
  // as an explicit, idempotent step for the website; on the phone we do it
  // automatically once the money has settled so the passenger can walk
  // straight from payment into check-in.
  const issued = useRef(false);
  const issueTickets = useCallback(async () => {
    if (issued.current) return;
    issued.current = true;
    try {
      await api.post('/api/v1/ticketing/issue', { bookingId: params.bookingId });
    } catch {
      // Seat/fare rules can defer ticketing; the confirmed booking still
      // stands and the passenger can retry from the boarding-pass screen.
      issued.current = false;
    }
  }, [params.bookingId]);

  useEffect(() => {
    if (booking?.status === 'CONFIRMED') void issueTickets();
  }, [booking?.status, issueTickets]);

  useEffect(() => {
    void refreshPayments();
    api
      .get<SiteSettingsDto>('/api/v1/site-settings')
      .then(setSite)
      .catch(() => undefined);
  }, [refreshPayments]);

  // Follow the latest paste for the active payment (pending / rejected state).
  useEffect(() => {
    if (!payment || !ACTIVE.includes(payment.status)) {
      setVerify(null);
      return;
    }
    api
      .get<MpesaManualVerificationDto | null>(`/api/v1/payments/${payment.id}/mpesa-manual`)
      .then(setVerify)
      .catch(() => undefined);
  }, [payment]);

  // Provider-side progress → poll; the booking is refreshed the moment it settles.
  useEffect(() => {
    if (!payment || !ACTIVE.includes(payment.status)) return;
    const timer = setInterval(() => {
      void api
        .get<PaymentDto>(`/api/v1/payments/${payment.id}`)
        .then((fresh) => {
          setPayments((list) => {
            const rest = list.filter((p) => p.id !== fresh.id);
            return [fresh, ...rest];
          });
          if (fresh.status === 'PAID') void issueTickets();
          if (fresh.status === 'PAID' || fresh.status === 'FAILED') refreshBooking();
        })
        .catch(() => undefined);
    }, 2_500);
    return () => clearInterval(timer);
  }, [payment, refreshBooking, issueTickets]);

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  function startManual(): void {
    void run(async () => {
      const created = await api.post<PaymentDto>('/api/v1/payments', {
        bookingId: params.bookingId,
        manual: true,
      });
      setPayments((list) => [created, ...list]);
      refreshBooking();
    });
  }

  function startStk(): void {
    void run(async () => {
      const created = await api.post<PaymentDto>('/api/v1/payments', {
        bookingId: params.bookingId,
        ...(msisdn.trim() ? { msisdn: msisdn.trim() } : {}),
      });
      setPayments((list) => [created, ...list]);
      refreshBooking();
    });
  }

  function submitMessage(): void {
    if (!payment || !message.trim()) return;
    void run(async () => {
      const res = await api.post<{
        record: MpesaManualVerificationDto;
        payment: PaymentDto;
      }>(`/api/v1/payments/${payment.id}/mpesa-manual`, { message: message.trim() });
      setVerify(res.record);
      setPayments((list) => [res.payment, ...list.filter((p) => p.id !== res.payment.id)]);
      setMessage('');
      if (res.payment.status === 'PAID') await issueTickets();
      refreshBooking();
    });
  }

  function simulate(resultCode: number): void {
    if (!payment) return;
    void run(async () => {
      const fresh = await api.post<PaymentDto>(`/api/v1/payments/${payment.id}/simulate`, {
        resultCode,
      });
      setPayments((list) => [fresh, ...list.filter((p) => p.id !== fresh.id)]);
      if (fresh.status === 'PAID') await issueTickets();
      refreshBooking();
    });
  }

  function resend(): void {
    if (!payment) return;
    void run(async () => {
      const fresh = await api.post<PaymentDto>(`/api/v1/payments/${payment.id}/stk`);
      setPayments((list) => [fresh, ...list.filter((p) => p.id !== fresh.id)]);
    });
  }

  if (isLoading || !booking) return <Loading label="Loading payment…" />;

  const amount = money(booking.totalMinor, booking.currency);
  const paybill = site?.mpesaPaybill ?? null;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={{ ...type.hero, color: colors.foreground }}>Payment</Text>
        <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.md }}>
          PNR {booking.pnr} · {booking.segments[0]?.originCode} →{' '}
          {booking.segments[0]?.destinationCode}
        </Text>

        <Card>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={{ ...type.title, color: colors.foreground }}>{amount}</Text>
            <Badge
              label={bookingConfirmed ? 'CONFIRMED' : (payment?.status ?? booking.status)}
              tone={
                bookingConfirmed ? 'success' : payment ? paymentTone(payment.status) : 'warning'
              }
            />
          </View>
          <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
            {booking.passengers.length} passenger{booking.passengers.length === 1 ? '' : 's'} ·{' '}
            {booking.segments[0]?.flightNumber ?? 'Flight'}
          </Text>
        </Card>

        {bookingConfirmed ? (
          <Card>
            <Text style={{ ...type.title, color: colors.success }}>Payment received</Text>
            <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
              {verify?.status === 'CONFIRMED'
                ? `Receipt ${verify.receiptNumber}. Your booking is confirmed and tickets are issued.`
                : 'Your booking is confirmed and tickets are issued.'}
            </Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                title="Check in"
                onPress={() => nav.navigate('CheckIn', { bookingId: booking.id })}
              />
              <Button
                title="Choose a seat"
                variant="secondary"
                onPress={() =>
                  nav.navigate('SeatPreview', {
                    flightId: booking.segments[0]?.flightId ?? '',
                    bookingId: booking.id,
                  })
                }
              />
              <Button title="Back to my trips" variant="ghost" onPress={() => nav.popToTop()} />
            </View>
          </Card>
        ) : active && payment?.manual ? (
          <Card>
            <Text style={{ ...type.title, color: colors.foreground }}>Pay by M-Pesa</Text>
            <Text style={{ ...type.caption, color: colors.mutedForeground, marginTop: 2 }}>
              Pay the paybill from your phone, then paste the confirmation SMS below.
            </Text>
            <View
              style={{
                marginTop: spacing.sm,
                padding: spacing.sm,
                backgroundColor: colors.secondary,
                borderRadius: radii.sm,
                gap: 4,
              }}
            >
              <Text style={{ ...type.caption, color: colors.mutedForeground }}>Paybill</Text>
              <Text style={{ ...type.title, color: colors.foreground }}>{paybill ?? '—'}</Text>
              <Text style={{ ...type.caption, color: colors.mutedForeground }}>Account / PNR</Text>
              <Text style={{ ...type.title, color: colors.foreground }}>{booking.pnr}</Text>
              <Text style={{ ...type.caption, color: colors.mutedForeground }}>Amount</Text>
              <Text style={{ ...type.title, color: colors.primary }}>{amount}</Text>
            </View>

            {verify?.status === 'CONFIRMED' && (
              <Text style={{ ...type.body, color: colors.success, marginTop: spacing.sm }}>
                Receipt {verify.receiptNumber} verified. Confirming your booking…
              </Text>
            )}
            {verify?.status === 'PENDING' && (
              <Text style={{ ...type.body, color: colors.warning, marginTop: spacing.sm }}>
                Receipt {verify.receiptNumber} is being checked.
              </Text>
            )}
            {verify?.status === 'REJECTED' && (
              <Text style={{ ...type.body, color: colors.destructive, marginTop: spacing.sm }}>
                {verify.rejectReason ?? 'That message could not be verified.'}
              </Text>
            )}

            {(!verify || verify.status === 'REJECTED') && (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ ...type.caption, color: colors.foreground, fontWeight: '600' }}>
                  Paste the M-Pesa confirmation message
                </Text>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  placeholder="e.g. SJH4LMOP32 confirmed. Ksh 12,500.00 sent to…"
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    minHeight: 88,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radii.sm,
                    padding: spacing.sm,
                    marginTop: spacing.xs,
                    color: colors.foreground,
                    backgroundColor: colors.card,
                    textAlignVertical: 'top',
                  }}
                />
                <View style={{ marginTop: spacing.sm }}>
                  <Button
                    title={busy ? 'Verifying…' : 'Verify payment'}
                    onPress={submitMessage}
                    disabled={busy || !message.trim()}
                    loading={busy}
                  />
                </View>
              </View>
            )}

            <View style={{ marginTop: spacing.sm }}>
              <Button
                title="Refresh status"
                variant="ghost"
                onPress={() => void refreshPayments()}
              />
            </View>
          </Card>
        ) : active && payment ? (
          <Card>
            <Text style={{ ...type.title, color: colors.foreground }}>Check your phone</Text>
            <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
              We sent an M-Pesa request. Enter your PIN to complete the payment.
            </Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button title="Resend request" variant="secondary" onPress={resend} disabled={busy} />
              <Button
                title="Simulate success (demo)"
                variant="ghost"
                onPress={() => simulate(0)}
                disabled={busy}
              />
              <Button
                title="Simulate cancellation (demo)"
                variant="ghost"
                onPress={() => simulate(1032)}
                disabled={busy}
              />
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={{ ...type.title, color: colors.foreground }}>Pay by M-Pesa</Text>
            <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
              Pay the paybill from your phone and paste the confirmation message — no card needed.
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <Button
                title={busy ? 'Starting…' : 'Pay with M-Pesa'}
                onPress={startManual}
                loading={busy}
              />
            </View>

            {showStk ? (
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                <Text style={{ ...type.caption, color: colors.foreground, fontWeight: '600' }}>
                  M-Pesa phone number (+254…)
                </Text>
                <TextInput
                  value={msisdn}
                  onChangeText={setMsisdn}
                  keyboardType="phone-pad"
                  placeholder="+254712345678"
                  placeholderTextColor={colors.mutedForeground}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radii.sm,
                    padding: spacing.sm,
                    color: colors.foreground,
                    backgroundColor: colors.card,
                  }}
                />
                <Button
                  title="Send STK push"
                  variant="secondary"
                  onPress={startStk}
                  disabled={busy}
                />
              </View>
            ) : (
              <Pressable onPress={() => setShowStk(true)} style={{ marginTop: spacing.sm }}>
                <Text style={{ ...type.caption, color: colors.primary }}>
                  Prefer an STK push? Enter your number
                </Text>
              </Pressable>
            )}
          </Card>
        )}

        {payment?.status === 'FAILED' && (
          <Card>
            <Text style={{ ...type.body, color: colors.destructive }}>
              {payment.failureMessage ?? 'The payment did not go through.'}
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <Button title="Try again" variant="secondary" onPress={resend} loading={busy} />
            </View>
          </Card>
        )}

        {error && (
          <Card>
            <Text style={{ ...type.body, color: colors.destructive }}>{error}</Text>
          </Card>
        )}

        <Text style={{ ...type.caption, color: colors.mutedForeground, marginTop: spacing.sm }}>
          Payments are verified against the M-Pesa receipt. Keep your confirmation SMS until the
          booking shows CONFIRMED.
        </Text>
      </ScrollView>
    </Screen>
  );
}
