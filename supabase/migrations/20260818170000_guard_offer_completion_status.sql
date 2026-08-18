-- Prevent a second accepted offer from completing a listing that was already
-- completed by another exchange.
create or replace function complete_offer(p_offer_id uuid, p_actor_id text)
returns offers
language plpgsql as $$
declare
  v_offer   offers;
  v_listing listings;
begin
  select * into v_offer from offers where id = p_offer_id for update;
  if not found then raise exception 'offer % not found', p_offer_id using errcode = 'no_data_found'; end if;

  select * into v_listing from listings where id = v_offer.listing_id for update;
  if not found then raise exception 'listing % not found', v_offer.listing_id using errcode = 'no_data_found'; end if;

  -- only a party to the offer may complete it
  if p_actor_id <> v_offer.seller_id and p_actor_id <> v_offer.buyer_id then
    raise exception 'actor % not party to offer %', p_actor_id, p_offer_id using errcode = 'insufficient_privilege';
  end if;
  if v_offer.status <> 'accepted' then
    raise exception 'offer % is % (expected accepted)', p_offer_id, v_offer.status using errcode = 'check_violation';
  end if;
  if v_listing.status <> 'active' then
    raise exception 'listing % is % (expected active)', v_listing.id, v_listing.status using errcode = 'check_violation';
  end if;

  update offers   set status = 'completed', completed_at = now() where id = v_offer.id   returning * into v_offer;
  update listings set status = 'completed', seller_id = v_offer.buyer_id where id = v_listing.id;  -- ownership swap
  return v_offer;
end;
$$;
