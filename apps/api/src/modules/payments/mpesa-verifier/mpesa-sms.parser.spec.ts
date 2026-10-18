import { describe, expect, it } from 'vitest';
import { parseMpesaSms } from './mpesa-sms.parser';

describe('parseMpesaSms', () => {
  it('parses a paybill confirmation (sent to … for account …)', () => {
    const parsed = parseMpesaSms(
      'SJH4LMOP32 confirmed. Ksh1,500.00 sent to ACCOUNT 0182774255 for account KQ7XYZ123 on 18/10/26 at 3:45 PM. New M-PESA balance is Ksh3,000.00.',
    );
    expect(parsed.receiptNumber).toBe('SJH4LMOP32');
    expect(parsed.amountMinor).toBe(150_000);
    expect(parsed.paybill).toBe('0182774255');
    expect(parsed.accountReference).toBe('KQ7XYZ123');
    expect(parsed.transactionAt).toBe('2026-10-18T12:45:00.000Z'); // 15:45 EAT
    expect(parsed.valid).toBe(true);
  });

  it('parses a buy-goods style confirmation', () => {
    const parsed = parseMpesaSms(
      'SBJ8K2LMN4 confirmed. Ksh950.00 paid to FLIGHT13 AIRLINES till 0182774255. New M-PESA balance is Ksh1,200.00.',
    );
    expect(parsed.receiptNumber).toBe('SBJ8K2LMN4');
    expect(parsed.amountMinor).toBe(95_000);
    expect(parsed.paybill).toBe('0182774255');
    expect(parsed.valid).toBe(true);
  });

  it('parses a Kiswahili paybill confirmation', () => {
    const parsed = parseMpesaSms(
      'SJH4LMOP32 imepokelewa. Ksh2,000.00 imetumwa kwa AKAUNTI 0182774255 kwa ajili ya akaunti ABC123 tarehe 18/10/26 saa 3:45 ME. Salio jipya la M-PESA ni Ksh3,000.00.',
    );
    expect(parsed.receiptNumber).toBe('SJH4LMOP32');
    expect(parsed.amountMinor).toBe(200_000);
    expect(parsed.paybill).toBe('0182774255');
    expect(parsed.accountReference).toBe('ABC123');
    expect(parsed.valid).toBe(true);
  });

  it('picks the payer phone from a P2P-style message', () => {
    const parsed = parseMpesaSms(
      'SBJ8K2LMN4 confirmed. Ksh500 from John Mutua 254712345678. New M-PESA balance is Ksh1,200.00.',
    );
    expect(parsed.amountMinor).toBe(50_000);
    expect(parsed.msisdn).toBe('254712345678');
    expect(parsed.paybill).toBeNull();
  });

  it('reads the local-format phone number too', () => {
    const parsed = parseMpesaSms(
      'SBJ8K2LMN4 confirmed. Ksh100.00 paid from phone number 0712345678 to 0182774255.',
    );
    expect(parsed.msisdn).toBe('0712345678');
    expect(parsed.paybill).toBe('0182774255');
  });

  it('flags a message without a receipt or amount as invalid', () => {
    expect(parseMpesaSms('Thank you for using M-Pesa').valid).toBe(false);
    expect(parseMpesaSms('Ksh1,500.00 sent to 0182774255').valid).toBe(false);
    expect(parseMpesaSms('SJH4LMOP32 confirmed.').valid).toBe(false);
  });

  it('never mistakes an uppercase word for a receipt', () => {
    const parsed = parseMpesaSms('MPECASHBACK confirmed. Ksh100.00 sent to 0182774255.');
    expect(parsed.receiptNumber).toBeNull();
    expect(parsed.valid).toBe(false);
  });

  it('never treats the paybill itself as the account reference', () => {
    const parsed = parseMpesaSms(
      'SJH4LMOP32 confirmed. Ksh1,500.00 sent to ACCOUNT 0182774255 for account 0182774255.',
    );
    expect(parsed.accountReference).toBeNull();
  });

  it('survives empty and whitespace input', () => {
    expect(parseMpesaSms('').valid).toBe(false);
    expect(parseMpesaSms('   \n ').valid).toBe(false);
  });
});
