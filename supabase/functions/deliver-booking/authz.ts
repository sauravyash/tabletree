// Delivery is allowed for the booking owner OR any staff member. Staff status is
// resolved by the caller (a user_roles lookup) so this stays a pure, testable rule.
export function authorize(booking: { user_id: string }, userId: string, isStaff: boolean): boolean {
  return booking.user_id === userId || isStaff;
}
