/**
 * A ContractToken is a typed key for the synchronous side of inter-module
 * communication.
 *
 * Events are the default: fire-and-forget, no coupling. But some calls need an
 * answer *now* — the AI concierge cannot generate a plan without knowing
 * whether the user is eligible. For those, a module publishes an interface
 * here and registers an implementation at boot. Consumers resolve the token
 * from the ContractRegistry and never learn which class satisfied it.
 *
 * The phantom `__type` gives us nominal typing: resolving a token yields the
 * declared interface with no cast at the call site.
 */
export interface ContractToken<T> {
  readonly key: string;
  /** Phantom — never populated at runtime. */
  readonly __type?: T;
}

export const contractToken = <T>(key: string): ContractToken<T> => ({ key });
