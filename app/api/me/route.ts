import { getCurrentUser } from '@/app/auth';

export function GET() {
  const user = getCurrentUser();
  return Response.json({ displayName: user.displayName, email: user.email });
}
