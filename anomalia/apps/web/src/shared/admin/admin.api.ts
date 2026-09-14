import { ROLES, type Page, type Role } from '@anomalia/contracts';
import { apiRequest } from '../api/client';
import { readAccessToken } from '../auth/session';

/**
 * The Back Office's read layer.
 *
 * Server-only, and enforced rather than asserted: it reads the session, which
 * imports `next/headers`, so pulling any of this into a client component is a
 * build error. That matters more here than elsewhere — these calls carry an
 * admin bearer token, and the whole point of the httpOnly session is that no
 * such token is ever reachable from the browser.
 *
 * Every response shape is the API's snake_case wire format, translated once,
 * here, so pages work in the app's own vocabulary.
 */

export interface AccountRow {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'active' | 'suspended';
  emailVerified: boolean;
  name: string | null;
  createdAt: string;
}

export interface AccountDetail extends AccountRow {
  emailVerifiedAt: string | null;
  locale: string;
  activeSessions: number;
  profile: {
    firstName: string | null;
    lastName: string | null;
    nationality: string | null;
    currentCountry: string | null;
    occupation: string | null;
    journeyStage: string | null;
  } | null;
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: 'success' | 'denied' | 'error';
  traceId: string;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface DirectoryFilters {
  search?: string;
  role?: string;
  status?: string;
  unverifiedOnly?: boolean;
  cursor?: string;
}

export async function fetchAccounts(filters: DirectoryFilters): Promise<Page<AccountRow>> {
  const page = await get<Page<WireAccount>>('/auth/users', {
    ...(filters.search ? { search: filters.search } : {}),
    // Only forward a role the contract knows. An arbitrary query string would
    // otherwise reach the API and come back as a validation error rendered as
    // a broken page, when the honest answer is "that filter does not exist".
    ...(isRole(filters.role) ? { role: filters.role } : {}),
    ...(isStatus(filters.status) ? { status: filters.status } : {}),
    ...(filters.unverifiedOnly ? { unverifiedOnly: 'true' } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
  });

  return { items: page.items.map(toAccountRow), nextCursor: page.nextCursor };
}

export async function fetchAccount(id: string): Promise<AccountDetail> {
  const user = await get<WireAccountDetail>(`/auth/users/${id}`, {});

  return {
    ...toAccountRow(user),
    emailVerifiedAt: user.email_verified_at,
    locale: user.locale,
    activeSessions: user.active_sessions,
    profile: user.profile,
  };
}

export interface AuditFilters {
  action?: string;
  result?: string;
  resourceId?: string;
  cursor?: string;
}

export async function fetchAuditTrail(filters: AuditFilters): Promise<Page<AuditRow>> {
  return get<Page<AuditRow>>('/audit', {
    ...(filters.action ? { action: filters.action } : {}),
    ...(isResult(filters.result) ? { result: filters.result } : {}),
    ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
    limit: '50',
  });
}

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await readAccessToken();
  const search = new URLSearchParams(params).toString();

  return apiRequest<T>(`${path}${search ? `?${search}` : ''}`, {
    ...(token ? { token } : {}),
    // Administrative screens must never show a cached view of who holds which
    // role — the whole reason someone opens this page is that it just changed.
    cache: 'no-store',
  });
}

interface WireAccount {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'active' | 'suspended';
  email_verified: boolean;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

interface WireAccountDetail extends WireAccount {
  email_verified_at: string | null;
  locale: string;
  active_sessions: number;
  profile: AccountDetail['profile'];
}

const toAccountRow = (user: WireAccount): AccountRow => ({
  id: user.id,
  email: user.email,
  role: user.role,
  status: user.status,
  emailVerified: user.email_verified,
  name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
  createdAt: user.created_at,
});

const isRole = (value: string | undefined): value is Role =>
  value !== undefined && (ROLES as readonly string[]).includes(value);

const isStatus = (value: string | undefined): value is 'pending' | 'active' | 'suspended' =>
  value === 'pending' || value === 'active' || value === 'suspended';

const isResult = (value: string | undefined): value is 'success' | 'denied' | 'error' =>
  value === 'success' || value === 'denied' || value === 'error';
