'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/shared/lib/cn';
import type { FeatureScreenProps } from '../../feature.definition';
import { useConcierge } from '../model/use-concierge';

export default function ConciergeScreen(_props: FeatureScreenProps) {
  const concierge = useConcierge();
  const [draft, setDraft] = useState('');

  const submit = () => {
    void concierge.ask(draft);
    setDraft('');
  };

  return (
    <Card className="mx-auto flex h-[70vh] max-w-3xl flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto pr-1">
        {concierge.turns.length === 0 ? (
          <p className="pt-8 text-center text-body text-muted">
            Ask about permits, neighbourhoods, schools, taxes or what to do next.
          </p>
        ) : null}

        <AnimatePresence initial={false}>
          {concierge.turns.map((turn) => (
            <motion.div
              key={turn.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-body',
                  turn.role === 'user'
                    ? 'bg-inverse text-inverse-ink'
                    : 'bg-ink/[0.05] text-ink',
                )}
              >
                <p className="whitespace-pre-wrap">{turn.content}</p>

                {turn.sources && turn.sources.length > 0 ? (
                  // Citations are not decoration: an uncited answer about
                  // immigration is not one the platform should be making.
                  <p className="mt-2 text-caption text-muted">
                    {turn.sources.length} verified source{turn.sources.length > 1 ? 's' : ''}
                  </p>
                ) : null}

                {turn.needsReview ? (
                  <p className="mt-2 rounded border border-hairline/[0.2] px-2 py-1 text-[0.6875rem] text-ink">
                    An advisor should confirm this before you act on it.
                  </p>
                ) : null}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {concierge.pending ? <p className="text-body text-muted">Thinking…</p> : null}
        {concierge.error ? <p className="text-body text-ink">{concierge.error}</p> : null}
      </div>

      <form
        className="mt-4 flex gap-2 border-t border-hairline/[0.12] pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Which area suits a family with two children?"
          className="flex-1 rounded-lg border border-hairline/[0.16] bg-surface px-3 py-2 text-body outline-none focus:border-ink/50"
        />
        <Button type="submit" disabled={concierge.pending || draft.trim().length === 0}>
          Send
        </Button>
      </form>
    </Card>
  );
}
