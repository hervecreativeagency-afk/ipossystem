import React, { useEffect, useState } from 'react';
import { MessageCircle, MessageSquareText, Check, Megaphone } from 'lucide-react';
import * as api from './api';
import { toast } from './Toast';
import { normalizePhone, displayPhone, receiptText, whatsappUrl, smsUrl } from './receipt-share';

// "Send receipt" panel under a receipt: WhatsApp or SMS from the shop's own
// phone, no paid service. Saves the number to Customers and, only with the
// customer's agreement, adds them to the offers list.
export default function ShareReceipt({ sale, company, companyId, money, balanceOwed }) {
  const [phone, setPhone] = useState(sale.customer_phone || '');
  const [optIn, setOptIn] = useState(false);
  const [already, setAlready] = useState(false);
  const [sent, setSent] = useState([]);
  const digits = normalizePhone(phone);

  useEffect(() => {
    let live = true;
    if (!sale.customer_id || sale.offline) return;
    api.loadCustomerMarketing(companyId, sale.customer_id).then(c => {
      if (!live || !c) return;
      if (!sale.customer_phone && c.phone) setPhone(c.phone);
      setAlready(Boolean(c.marketing_opt_in));
    }).catch(() => {});
    return () => { live = false; };
  }, [sale.id]);

  function send(channel) {
    if (!digits) { toast('Enter the customer’s phone number, e.g. 0977 123 456.', 'error'); return; }
    const text = receiptText(sale, { channel, company, money, balanceOwed });
    const url = channel === 'whatsapp' ? whatsappUrl(digits, text) : smsUrl(digits, text);
    // Open straight from the tap so phones don't block it.
    if (channel === 'whatsapp') window.open(url, '_blank', 'noopener');
    else window.location.href = url;
    setSent(s => [...new Set([...s, channel])]);
    if (sale.offline) { toast('Receipt opened. This sale is offline, so the number is not saved to Customers. Send it again from Receipts after it syncs to save it.', 'info', 7000); return; }
    api.recordReceiptShare({ companyId, saleId: sale.id, channel, phone: displayPhone(digits), name: sale.customer_name, optIn })
      .then(() => { if (optIn) { setAlready(true); setOptIn(false); } })
      .catch(e => toast('Receipt opened, but the number was not saved: ' + (e.message || 'please try again'), 'error'));
  }

  return (
    <section className="share-receipt no-print" aria-label="Send receipt to customer">
      <div className="share-head"><strong>Send receipt to phone</strong><small>Free · sent from this device’s WhatsApp or SMS</small></div>
      <label className="share-phone">
        Customer phone
        <input type="tel" inputMode="tel" autoComplete="off" placeholder="0977 123 456" value={phone} onChange={e => setPhone(e.target.value)} />
      </label>
      {phone && !digits && <small className="share-hint">Check the number: use 10 digits like 0977 123 456, or +country code.</small>}
      {digits && <small className="share-hint">Sends to {displayPhone(digits)}</small>}
      {already ? (
        <p className="share-optin is-on"><Megaphone size={15} /> This customer receives offers.</p>
      ) : (
        <label className="share-optin">
          <input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} />
          <span>Customer agrees to receive offers and news from {company.name || 'the shop'}</span>
        </label>
      )}
      <div className="share-buttons">
        <button type="button" className="share-wa" onClick={() => send('whatsapp')} disabled={!phone}>
          {sent.includes('whatsapp') ? <Check size={17} /> : <MessageCircle size={17} />} WhatsApp
        </button>
        <button type="button" className="secondary" onClick={() => send('sms')} disabled={!phone}>
          {sent.includes('sms') ? <Check size={17} /> : <MessageSquareText size={17} />} SMS
        </button>
      </div>
    </section>
  );
}
