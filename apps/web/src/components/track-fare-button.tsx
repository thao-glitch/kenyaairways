'use client';

import { useState } from 'react';
import type { PriceAlertDto } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { ApiRequestError, apiCall } from '@/lib/api-client';

interface TrackFareButtonProps {
  originCode: string;
  destinationCode: string;
}

/**
 * Skyscanner-style price alert for the route currently being viewed.
 * Signed out → routes to the sign-in page; already tracking → stays pressed.
 */
export function TrackFareButton({ originCode, destinationCode }: TrackFareButtonProps) {
  const { t } = useT();
  const [state, setState] = useState<'idle' | 'busy' | 'tracking' | 'error'>('idle');

  async function track(): Promise<void> {
    setState('busy');
    try {
      await apiCall<PriceAlertDto>('/api/v1/price-alerts', {
        method: 'POST',
        body: { originCode, destinationCode, cabin: 'ECONOMY' },
      });
      setState('tracking');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        const next = encodeURIComponent(
          `/flights?origin=${originCode}&destination=${destinationCode}`,
        );
        window.location.assign(`/login?next=${next}`);
        return;
      }
      // CONFLICT = already tracking this route (someone double-clicked earlier).
      if (err instanceof ApiRequestError && err.status === 409) {
        setState('tracking');
        return;
      }
      setState('error');
    }
  }

  if (state === 'tracking') {
    return (
      <Button variant="outline" size="sm" disabled aria-live="polite">
        ✓ {t('alerts.tracking')}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void track()}
        disabled={state === 'busy'}
        aria-live="polite"
      >
        {state === 'busy' ? '…' : `🔔 ${t('alerts.track')}`}
      </Button>
      {state === 'error' && (
        <span className="text-xs text-destructive" role="alert">
          {t('alerts.error')}
        </span>
      )}
    </div>
  );
}
