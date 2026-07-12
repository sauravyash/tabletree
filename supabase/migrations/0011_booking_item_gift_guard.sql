-- Rework the booking_items guard for the beverage/flower + free-gift model.
-- Beverages and flowers are both purchasable products now, and a booking_item may be
-- a paid item or a free gift (is_gift). The prior guard hard-blocked all inserts behind
-- floral_purchase_enabled, rejected unpriced variants, and force-snapshotted the variant
-- price — none of which fit gifts (must be $0) or as-yet-unpriced flowers.

create or replace function guard_booking_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_handle text;
begin
  select price_cents, active into v from product_variants where id = new.variant_id;
  if v is null or not v.active then
    raise exception 'variant_inactive';
  end if;

  -- Free gifts: always $0, no options, exempt from purchase/pricing gates.
  if new.is_gift then
    new.price_cents_snapshot := 0;
    new.option_snapshot := '{}'::jsonb;
    return new;
  end if;

  -- Paid items: validate options (only variants that define options may carry one).
  if exists (select 1 from variant_options o where o.variant_id = new.variant_id) then
    v_handle := new.option_snapshot->>'handle';
    if v_handle is null or not exists (
      select 1 from variant_options o
      where o.variant_id = new.variant_id and o.option_key = 'handle' and o.option_value = v_handle
    ) then
      raise exception 'invalid_option';
    end if;
    new.option_snapshot := jsonb_build_object('handle', v_handle);
  else
    new.option_snapshot := '{}'::jsonb;
  end if;

  -- Server-side price snapshot; unpriced variants (e.g. flowers pending pricing)
  -- snapshot to $0 since in-funnel payment is display-only.
  new.price_cents_snapshot := coalesce(v.price_cents, 0);
  return new;
end;
$$;
