'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/shared/lib/cn';

export interface NavItem {
  key: string;
  title: string;
  href: string;
  icon: string;
}

/**
 * Section navigation. Renders whatever the registry resolved to and holds no
 * list of its own.
 *
 * The active item is marked with a rule on its leading edge rather than a
 * filled pill — at this size a solid block would out-weigh the page content it
 * is pointing at.
 */
export function PortalNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  if (items.length === 0) {
    return (
      <nav className="w-full shrink-0 lg:w-52">
        <p className="text-caption text-muted">No features are enabled for this account.</p>
      </nav>
    );
  }

  return (
    <nav className="w-full shrink-0 lg:w-52" aria-label="Portal sections">
      <Eyebrow className="hidden lg:block">Sections</Eyebrow>

      {/* Scrolls horizontally on phones, stacks from lg upward. */}
      <ul className="mt-0 flex gap-1 overflow-x-auto lg:mt-5 lg:flex-col lg:gap-0 lg:overflow-visible">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap rounded-full px-3 py-1.5 text-body transition-colors duration-200 ease-editorial',
                  'lg:rounded-none lg:border-l lg:px-4 lg:py-2.5',
                  active
                    ? 'bg-ink/[0.05] text-ink lg:bg-transparent lg:border-ink'
                    : 'text-muted hover:text-ink lg:border-hairline/[0.12]',
                )}
              >
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
