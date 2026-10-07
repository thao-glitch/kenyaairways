/**
 * Safaricom Daraja result codes with user-facing copy (English + Swahili)
 * and retry semantics. Codes are stable across sandbox and production.
 */

export type MpesaResultCategory =
  | 'success'
  | 'insufficient_funds'
  | 'cancelled'
  | 'timeout'
  | 'wrong_pin'
  | 'in_process'
  | 'failed';

export interface MpesaResultInfo {
  code: number;
  label: string;
  /** Customer-facing message (English). */
  en: string;
  /** Customer-facing message (Swahili scaffold). */
  sw: string;
  /** The customer may retry without creating a duplicate booking. */
  retryable: boolean;
  category: MpesaResultCategory;
}

export const MPESA_RESULT_CODES: Record<number, MpesaResultInfo> = {
  0: {
    code: 0,
    label: 'Success',
    en: 'Payment received. Your booking is confirmed.',
    sw: 'Malipo yamepokelewa. Nafasi yako imethibitishwa.',
    retryable: false,
    category: 'success',
  },
  1: {
    code: 1,
    label: 'Insufficient funds',
    en: 'The balance on your M-Pesa account is insufficient for this transaction.',
    sw: 'Salio kwenye akaunti yako ya M-Pesa halitoshi kwa muamala huu.',
    retryable: true,
    category: 'insufficient_funds',
  },
  1032: {
    code: 1032,
    label: 'Request cancelled by user',
    en: 'You cancelled the payment request. You can try again.',
    sw: 'Uegemeza ombi la malipo. Unaweza jaribu tena.',
    retryable: true,
    category: 'cancelled',
  },
  1037: {
    code: 1037,
    label: 'Timeout / user unreachable',
    en: 'We could not reach your phone in time. Check your network and try again.',
    sw: 'Hatuwezi kufikia simu yako. Angalia muunganisho wako na jaribu tena.',
    retryable: true,
    category: 'timeout',
  },
  2001: {
    code: 2001,
    label: 'Wrong PIN',
    en: 'The M-Pesa PIN you entered was incorrect.',
    sw: 'Namba ya PIN uliyoingiza si sahihi.',
    retryable: true,
    category: 'wrong_pin',
  },
  1001: {
    code: 1001,
    label: 'Transaction already in process',
    en: 'A transaction is already in progress on your line. Please wait a moment.',
    sw: 'Muamala tayari unaendelea kwenye laini yako. Tafadhali subiri.',
    retryable: true,
    category: 'in_process',
  },
  9999: {
    code: 9999,
    label: 'Request cancelled',
    en: 'The payment request was cancelled. You can try again.',
    sw: 'Ombi la malipo limefutwa. Unaweza jaribu tena.',
    retryable: true,
    category: 'cancelled',
  },
};

const FALLBACK: MpesaResultInfo = {
  code: -1,
  label: 'Payment failed',
  en: 'Your payment could not be completed. No money was deducted — please try again.',
  sw: 'Malipo hayakukamilika. Hakuna pesa iliyokatwa — tafadhali jaribu tena.',
  retryable: true,
  category: 'failed',
};

export function describeMpesaResult(code: number): MpesaResultInfo {
  return MPESA_RESULT_CODES[code] ?? { ...FALLBACK, code };
}

export function isMpesaSuccess(code: number): boolean {
  return code === 0;
}

/**
 * Daraja C2B Validation response codes (lowercase-wire format used by Safaricom).
 * Validation rejects BEFORE money moves; confirmation cannot be rejected.
 */
export const C2B_VALIDATION = {
  ACCEPT: { ResultCode: '0', ResultDesc: 'Accepted' },
  INVALID_ACCOUNT: {
    ResultCode: '400.001.01',
    ResultDesc: 'Invalid or unknown account number',
  },
  INVALID_AMOUNT: { ResultCode: '400.001.02', ResultDesc: 'Invalid or mismatched amount' },
  NOT_PAYABLE: { ResultCode: '400.001.03', ResultDesc: 'Account is not payable' },
} as const;
