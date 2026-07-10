-- The guard trigger function is SECURITY DEFINER but is only ever invoked by
-- the BEFORE INSERT trigger — it must not be callable as a PostgREST RPC.
-- Trigger execution does not check EXECUTE privilege, so revoking it from the
-- API roles closes the /rest/v1/rpc/guard_booking_item surface without
-- affecting the trigger. (Resolves advisor lints 0028/0029.)
revoke execute on function public.guard_booking_item() from public, anon, authenticated;
