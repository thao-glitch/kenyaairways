'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/components/i18n-provider';

const pad2 = (n: number): string => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number): string => `${y}-${pad2(m + 1)}-${pad2(d)}`;

export const todayIso = (): string => {
  const now = new Date();
  return isoOf(now.getFullYear(), now.getMonth(), now.getDate());
};

type View = { year: number; month: number }; // month: 0-based

/**
 * Fast calendar: one click on the field opens a month grid (no OS date
 * dialog, no typing) — prev/next month, past days disabled, locale-aware
 * labels. Emits `YYYY-MM-DD`.
 */
export function DatePicker({
  value,
  onChange,
  min,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>(() => {
    const base = value || min || todayIso();
    const [y, m] = base.split('-');
    return { year: Number(y), month: Number(m.slice(0, 2)) - 1 };
  });
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    if (!value) return '';
    const [y, m, d] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }, [value, locale]);

  const weekdayHead = useMemo(() => {
    // Monday-first short labels, derived from the active locale.
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2024, 0, 1 + i))));
  }, [locale]);

  const days = useMemo(() => {
    const firstDow = (new Date(Date.UTC(view.year, view.month, 1)).getUTCDay() + 6) % 7; // Mon=0
    const count = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
    const cells: (string | null)[] = Array.from({ length: firstDow }, () => null);
    for (let d = 1; d <= count; d += 1) cells.push(isoOf(view.year, view.month, d));
    return cells;
  }, [view]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(Date.UTC(view.year, view.month, 1)),
      ),
    [view, locale],
  );

  const step = (delta: number): void => {
    const next = new Date(Date.UTC(view.year, view.month + delta, 1));
    setView({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  const minDay = min ?? todayIso();

  return (
    <div ref={boxRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-11 w-full items-center rounded-md border border-input bg-background px-3 text-left text-sm shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          shown ? '' : 'text-muted-foreground'
        }`}
      >
        {shown || placeholder || t('search.pickDate')}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute z-50 mt-1 w-72 rounded-lg border bg-background p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label={t('calendar.prev')}
              onClick={() => step(-1)}
              className="rounded-md px-2 py-1 text-sm hover:bg-accent"
            >
              ‹
            </button>
            <span className="text-sm font-semibold">{monthLabel}</span>
            <button
              type="button"
              aria-label={t('calendar.next')}
              onClick={() => step(1)}
              className="rounded-md px-2 py-1 text-sm hover:bg-accent"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {weekdayHead.map((w, i) => (
              <span
                key={`${w}-${i}`}
                className="py-1 text-center text-[10px] font-medium text-muted-foreground"
              >
                {w}
              </span>
            ))}
            {days.map((iso, i) => {
              if (iso === null) return <span key={`pad-${i}`} />;
              const disabled = iso < minDay;
              const selected = iso === value;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={`rounded-md py-1.5 text-xs font-medium transition-colors ${
                    selected
                      ? 'bg-primary text-primary-foreground'
                      : disabled
                        ? 'cursor-not-allowed text-muted-foreground/40'
                        : 'hover:bg-accent'
                  }`}
                >
                  {Number(iso.slice(8))}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
