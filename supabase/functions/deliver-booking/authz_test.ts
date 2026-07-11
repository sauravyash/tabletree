import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { authorize } from './authz.ts';

Deno.test('owner is authorized', () => {
  assertEquals(authorize({ user_id: 'u1' }, 'u1', false), true);
});
Deno.test('staff non-owner is authorized', () => {
  assertEquals(authorize({ user_id: 'u1' }, 'u2', true), true);
});
Deno.test('non-staff non-owner is rejected', () => {
  assertEquals(authorize({ user_id: 'u1' }, 'u2', false), false);
});
