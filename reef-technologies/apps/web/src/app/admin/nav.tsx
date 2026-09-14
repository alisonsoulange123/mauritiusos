'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/shared/lib/cn';

/**
 * Back office navigation.
 *
 * Told what to render rather than working it out: a client component's props
 * are visible to the viewer, so it receives a resolved list of sections and
 * never a role.
 */
export function AdminNav({ sections }: { sections: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  const items = sections;

  return (
    <nav className="mt-5" aria-label="Back office sections">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:gap-0 lg:overflow-visible">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap rounded-full px-3 py-1.5 text-body transition-colors duration-200 ease-editorial',
                  'lg:rounded-none lg:border-l lg:px-4 lg:py-2.5',
                  active
                    ? 'bg-ink/[0.05] text-ink lg:border-ink lg:bg-transparent'
                    : 'text-muted hover:text-ink lg:border-hairline/[0.12]',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
