import { getUser } from '../mock/db.js';
import type { AuthContext } from '../types/chat.js';

export function authGuard(userId: string): AuthContext {
  if (!userId) {
    throw Object.assign(new Error('user_id is required'), { code: 'AUTH_MISSING_USER', status: 401 });
  }

  const user = getUser(userId);
  if (!user || !user.active) {
    throw Object.assign(new Error('user not found or inactive'), { code: 'AUTH_INVALID_USER', status: 403 });
  }

  if (user.balance <= 0) {
    throw Object.assign(new Error('insufficient balance'), { code: 'AUTH_NO_BALANCE', status: 402 });
  }

  return {
    userId,
    plan: user.plan,
    balance: user.balance
  };
}
