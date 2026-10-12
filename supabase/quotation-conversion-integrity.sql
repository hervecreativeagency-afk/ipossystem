alter table public.quotations add constraint converted_quote_sale_required check((status='converted')=(converted_sale_id is not null));
