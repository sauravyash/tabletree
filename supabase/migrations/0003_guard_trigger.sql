create or replace function guard_booking_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v record;
  v_handle text;
begin
  select (value)::boolean into v_enabled from app_config where key = 'floral_purchase_enabled';
  if not coalesce(v_enabled, false) then
    raise exception 'floral_purchase_disabled';
  end if;

  select price_cents, active, product_id into v
  from product_variants where id = new.variant_id;
  if v is null or not v.active then
    raise exception 'variant_inactive';
  end if;
  if v.price_cents is null then
    raise exception 'variant_unpriced';
  end if;

  -- Options: only Box variants may carry a handle; validate it.
  if exists (select 1 from variant_options o where o.variant_id = new.variant_id) then
    v_handle := new.option_snapshot->>'handle';
    if v_handle is null or not exists (
      select 1 from variant_options o
      where o.variant_id = new.variant_id and o.option_key='handle' and o.option_value=v_handle
    ) then
      raise exception 'invalid_option';
    end if;
    new.option_snapshot := jsonb_build_object('handle', v_handle);
  else
    new.option_snapshot := '{}'::jsonb;   -- Table Tree: no options
  end if;

  new.price_cents_snapshot := v.price_cents;   -- server-side snapshot
  return new;
end;
$$;

create trigger trg_guard_booking_item
  before insert on booking_items
  for each row execute function guard_booking_item();
