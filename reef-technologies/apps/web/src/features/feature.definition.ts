import type { ComponentType } from 'react';
import type { ModuleKey, Role } from '@reef-technologies/contracts';

/**
 * A frontend FEATURE SLICE's declaration of itself — the mirror image of the
 * backend's module definition, and for the same reason: a feature states its
 * own requirements so that enabling or removing it is a registry edit.
 */
export interface FeatureDefinition {
  /** Stable id. Also the URL segment under the portal. */
  key: string;

  /** Shown in nav and page titles. */
  title: string;

  /** One line for empty states and tooltips. */
  description: string;

  /**
   * Backend modules this feature needs.
   *
   * The important one. At render time we compare this against
   * `GET /_platform/capabilities`, so a feature whose API is switched off
   * disappears from the UI instead of rendering a screen that 404s. You can
   * ship the billing UI months before billing is enabled, then turn it on with
   * an env var on the API — no frontend deploy.
   */
  requiresModules: ModuleKey[];

  /** Roles permitted to see it. Empty = any authenticated user. */
  requiresRoles?: Role[];

  /** Visible to anonymous visitors (landing funnel: assessment, knowledge). */
  public?: boolean;

  /**
   * Lazy loader. A dynamic import, so a disabled or unauthorized feature's
   * code is never downloaded — the bundle reflects what the user can actually
   * reach.
   */
  mount: () => Promise<{ default: ComponentType<FeatureScreenProps> }>;

  /**
   * Editorial copy for the landing page grid.
   *
   * Colocated with the feature rather than held in the page, so a slice owns
   * everything about itself — its screen, its data access, and how it is
   * described publicly. A feature that is switched off takes its marketing
   * copy off the landing page with it, which is why there is no separate list
   * of sections to keep in sync.
   */
  marketing?: {
    /** Short headline for the grid cell. Sentence case, no full stop. */
    headline: string;
    /** One or two sentences. Concrete over aspirational. */
    body: string;
    /**
     * Call-to-action label, when this feature is a sensible entry point.
     * Features carrying one become candidates for the hero and header buttons,
     * in nav order — so those buttons can never point at a feature this
     * deployment does not serve.
     */
    cta?: string;
  };

  nav?: {
    /** Lower sorts first. */
    order: number;
    /** Lucide icon name, resolved by the nav component. */
    icon: string;
    /** Hidden from nav but still routable (deep links, embeds). */
    hidden?: boolean;
  };
}

/** Props every feature screen receives from the app shell. */
export interface FeatureScreenProps {
  locale: string;
  tenant: string;
}

/** Identity helper, for symmetry with the backend's `defineModule`. */
export const defineFeature = (definition: FeatureDefinition): FeatureDefinition => definition;
