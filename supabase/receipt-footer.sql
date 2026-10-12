alter table public.companies add column receipt_footer text not null default E'Thank you for shopping with us.\nWe look forward to seeing you again.' check(char_length(receipt_footer)<=500);
grant update(receipt_footer) on public.companies to authenticated;
