import type { Page } from '@anomalia/contracts';
import { apiRequest } from '../api/client';
import { readAccessToken } from '../auth/session';

/**
 * The Back Office's knowledge read layer.
 *
 * Server-only by construction, like the account directory: it reads the
 * session, which imports `next/headers`, so a client import is a build error.
 */

export type KnowledgeStatus = 'draft' | 'review' | 'published' | 'archived';

export interface KnowledgeRow {
  id: string;
  title: string;
  slug: string;
  type: string;
  category: string;
  locale: string;
  status: KnowledgeStatus;
  confidenceScore: number;
  verifiedAt: string | null;
  sourceName: string | null;
  /** Published, but past the verification window — search is withholding it. */
  stale: boolean;
  createdAt: string;
}

export interface KnowledgeItem extends KnowledgeRow {
  content: string;
  sourceId: string | null;
  sourceAuthority: string | null;
  /** Resolved by the server's own policy, so the UI cannot offer an illegal move. */
  nextStates: KnowledgeStatus[];
  editable: boolean;
}

export interface SourceRow {
  id: string;
  name: string;
  sourceType: string;
  authorityLevel: string;
  url: string | null;
  verifiedAt: string | null;
}

export interface KnowledgeFilters {
  status?: string;
  search?: string;
  language?: string;
  staleOnly?: boolean;
  cursor?: string;
}

const STATUSES: KnowledgeStatus[] = ['draft', 'review', 'published', 'archived'];

export async function fetchKnowledge(filters: KnowledgeFilters): Promise<Page<KnowledgeRow>> {
  return get<Page<KnowledgeRow>>('/knowledge', {
    ...(isStatus(filters.status) ? { status: filters.status } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.language === 'en' || filters.language === 'fr'
      ? { language: filters.language }
      : {}),
    ...(filters.staleOnly ? { staleOnly: 'true' } : {}),
    ...(filters.cursor ? { cursor: filters.cursor } : {}),
  });
}

export const fetchKnowledgeItem = (id: string): Promise<KnowledgeItem> =>
  get<KnowledgeItem>(`/knowledge/${id}`, {});

export const fetchSources = (): Promise<SourceRow[]> => get<SourceRow[]>('/knowledge/sources', {});

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await readAccessToken();
  const search = new URLSearchParams(params).toString();

  return apiRequest<T>(`${path}${search ? `?${search}` : ''}`, {
    ...(token ? { token } : {}),
    // Editorial screens must never show a cached view of what is published —
    // the reason someone is looking is usually that it just changed.
    cache: 'no-store',
  });
}

const isStatus = (value: string | undefined): value is KnowledgeStatus =>
  value !== undefined && (STATUSES as string[]).includes(value);
