import { PriceAlertsList } from '@/components/price-alerts-list';
import { getTranslator } from '@/lib/i18n';

/** My price alerts (Flight13 price-alert feature — list is client-fetched). */
export default async function AlertsPage() {
  const { t } = await getTranslator();
  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">{t('alerts.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('alerts.body')}</p>
      </section>
      <PriceAlertsList />
    </div>
  );
}
