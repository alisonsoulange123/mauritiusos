import { redirect } from 'next/navigation';
import { Eyebrow } from '@/components/ui/eyebrow';
import { apiRequest } from '@/shared/api/client';
import { getSession, readAccessToken } from '@/shared/auth/session';
import { ProfileForm, type Profile } from '@/components/portal/profile-form';

export const metadata = { title: 'Your profile' };

/** Reads a cookie and per-user data; never pre-rendered, never cached. */
export const dynamic = 'force-dynamic';

/**
 * The profile the decision engine runs on.
 *
 * A static segment, so it wins over `/portal/[feature]` — this is account
 * data rather than a registry-driven feature, and it should not appear or
 * disappear with a module flag.
 */
export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/portal/profile');

  const token = await readAccessToken();
  const profile = await apiRequest<Profile>('/auth/profile', {
    ...(token ? { token } : {}),
    cache: 'no-store',
  });

  const missing = [
    profile.nationality ? null : 'nationality',
    profile.birthDate ? null : 'date of birth',
    profile.monthlyIncome === null ? 'monthly income' : null,
    profile.familyStatus ? null : 'who you are moving with',
  ].filter((field): field is string => field !== null);

  return (
    <div>
      <Eyebrow>Account</Eyebrow>
      <h1 className="mt-6 text-title text-balance">Your profile</h1>
      <p className="mt-4 max-w-prose text-lead text-muted text-pretty">
        The eligibility rules are evaluated against these answers, not generated from them.
        Nothing here is used for anything else.
      </p>

      {/*
        Named rather than implied. Eligibility needs all four, and the engine
        returns no verdict at all when one is missing — so "the concierge said
        nothing about permits" has a cause the person can act on.
      */}
      {missing.length > 0 ? (
        <p className="mt-6 max-w-prose border-l-2 border-ink py-1 pl-3 text-caption text-ink text-pretty">
          Until you add your {formatList(missing)}, the concierge cannot tell you which permits
          you qualify for — it declines rather than guessing.
        </p>
      ) : null}

      <ProfileForm profile={profile} />
    </div>
  );
}

const formatList = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) as string}`;
