# iPOS — Retail POS

React + Vite + Tailwind CSS with Supabase Auth and company-scoped RLS. Includes POS, products/costs, suppliers/purchases, quotations, receipts, cashbook, reports, returns, shifts, stock adjustments, staff management and audit history.

## Run

`npm install`, then `npm run dev`. Build: `npm run build`. Tests: `npm test`.

## Vercel

Import this repository. Framework: **Vite**. Build command: `npm run build`. Output: `dist`. `vercel.json` supports direct React Router URLs. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for production/preview. Existing `.env.production` contains only public Supabase configuration. Never expose service-role/secret keys.

After deployment, configure Supabase Auth Site URL and `/login` and `/reset-password` redirect URLs for the new origin. The staff invitation Edge Function currently targets the original hosted site; update its allowed origin and redirect once the new deployment URL is verified. Custom SMTP is needed for reliable employee email delivery.

## Daily workflow

Open a cashier shift before checkout. Optional customer name/phone appear on receipts. Supervisors/directors approve refunds, record externally handled payouts and optionally restore stock. Receipt settings include company logo, contacts, footer, return policy and paper width. Company logos are separate from official iPOS branding. Staff join through invitations; directors can change operational roles or disable access.

## Database

SQL under `supabase/` records the reference schema and additive changes already applied to the connected project. **Do not rerun every file against that database.** For a different project, review dependencies and apply in order. Local database verification fixtures, build output and credentials are excluded from this repository. Edge Function secrets belong in its server runtime.

Refunds preserve original sales, allocate discounts/tax at cent precision, reject excess quantities and support idempotent retry. Drawer transfers are separate from business income/expense. P&L depends on recorded costs and opening balances; balance reconciliation checks arithmetic rather than accounting completeness.

Local tax invoices/refund receipts are not submitted to ZRA or certified fiscal documents. Bank/mobile-money transfers are recorded, not sent by this app.

## Verification

Production build and 23 unit tests passed. Rollback live database checks verified checkout/retries, mixed payment/change, partial/full refunds/restocking, adjustment limits, quotation conversion, shift reconciliation, audit and role/company restrictions. Browser/device, actual email activation/inbox delivery, concurrent checkout sessions and physical printer/scanner checks remain before an operational pilot.

## Email verification links

Sign-up confirmation emails open an iPOS page instead of a Supabase address, using the same link structure as MongoDB Atlas:

`https://ipossystem.vercel.app/account/email/verify?token_hash=…&type=signup&n=%2Faccount%2Fregister%2Fsuccess&username=owner%40store.com`

| Part | Meaning |
|---|---|
| `/account/email/verify` | iPOS confirmation page (asks for one tap, so email scanners can't use up the link) |
| `token_hash` | one-time secret from Supabase; removed from the address bar after the page opens |
| `type` | `signup`, `invite`, `recovery`, `email_change` or `magiclink` |
| `n` | iPOS page to open after confirming; links to other websites are refused |
| `username` | the email address being confirmed (display only) |

After confirming, new directors land on `/account/register/success`, which waits for the company workspace to be created. Expired links offer "Send a new link".

**Setup in Supabase (one time):**
1. Authentication → Emails → **Confirm signup**: subject `Confirm your email for iPOS`, body = `supabase/email-templates/confirm-signup.html`.
2. Authentication → URL Configuration → Redirect URLs: add `https://ipossystem.vercel.app/**`.

Until the template is changed, the default Supabase link still works: it now returns to `/account/register/success`.

## WhatsApp / SMS receipts and the offers list

Every receipt has **Send receipt to phone**: type or confirm the customer's number and tap **WhatsApp** or **SMS**. The message opens on the shop's own phone with the receipt filled in; one more tap sends it. No paid service is used.

- Numbers are normalised to Zambia by default (`0977 123 456`, `977123456`, `+260…` are the same customer).
- Sending saves the number as a customer and links the sale (`record_receipt_share`, `supabase/receipt-sharing.sql`, applied).
- Customers join the **offers list** only when staff tick that they agreed (Data Protection Act 2021). Date and staff member are recorded; opting out is on the Customers page.
- Customers → **Offers list** exports only customers who agreed (CSV, spreadsheet-safe).
- Automatic sending without a tap needs a paid WhatsApp Business API or SMS provider; not included.
