import { redirect } from 'next/navigation';
import { getSession } from '@/shared/auth/session';
import { sectionsFor } from '@/shared/admin/sections';

export const dynamic = 'force-dynamic';

/**
 * No overview worth a page yet, so this is a signpost.
 *
 * It cannot simply point at the directory: a knowledge manager cannot open
 * that, and would bounce straight back out of the Back Office they were just
 * let into. The first section they can actually see is the right landing spot.
 */
export default async function AdminIndexPage() {
  const session = await getSession();
  const [first] = sectionsFor(session?.roles ?? []);
  redirect(first?.href ?? '/portal');
}
