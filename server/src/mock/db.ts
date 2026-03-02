const users = new Map<string, { plan: 'free' | 'pro'; balance: number; active: boolean }>([
  ['u_001', { plan: 'pro', balance: 999, active: true }],
  ['u_002', { plan: 'free', balance: 3, active: true }],
  ['u_003', { plan: 'free', balance: 0, active: false }]
]);

export function getUser(userId: string) {
  return users.get(userId);
}

export function consumeBalance(userId: string, amount = 1) {
  const user = users.get(userId);
  if (!user) return;
  user.balance = Math.max(0, user.balance - amount);
  users.set(userId, user);
}
