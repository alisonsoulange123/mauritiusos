'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { FeatureScreenProps } from '../../feature.definition';
import { searchKnowledge, type KnowledgeHit } from '../api/knowledge.api';

export default function KnowledgeScreen({ locale }: FeatureScreenProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KnowledgeHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = () => {
    if (query.trim().length < 2) return;
    startTransition(() => {
      void searchKnowledge(query, locale)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setSearched(true));
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="retirement permit, property purchase, tax residence…"
          className="flex-1 rounded-lg border border-hairline/[0.16] bg-surface px-3 py-2 text-body outline-none focus:border-ink/50"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {searched && hits.length === 0 ? (
        <Card>
          <p className="text-body text-muted">
            Nothing verified matches that yet. Missing topics are tracked and prioritised.
          </p>
        </Card>
      ) : null}

      {hits.map((hit) => (
        <Card key={hit.knowledgeId}>
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-medium">{hit.title}</h3>
            <span className="shrink-0 rounded-full bg-ink/[0.05] px-2 py-0.5 text-[0.6875rem] text-muted">
              {hit.type}
            </span>
          </div>
          <p className="mt-2 text-body text-muted">{hit.excerpt}</p>
          {/* Provenance in the UI, not just the database: the user can judge
              how much weight to give the answer. */}
          <p className="mt-3 text-caption text-muted">
            {hit.sourceAuthority} source · {Math.round(hit.confidence * 100)}% confidence
            {hit.lastVerifiedAt
              ? ` · checked ${new Date(hit.lastVerifiedAt).toLocaleDateString()}`
              : ' · not yet verified'}
          </p>
        </Card>
      ))}
    </div>
  );
}
