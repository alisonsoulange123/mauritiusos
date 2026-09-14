"""Model providers, behind ports.

The worker is the only place in the platform allowed to call a model, and this
is the only place in the worker that knows which one. Everything above depends
on the protocols in `base`, so swapping a vendor — or running with none at all —
is a factory change, not a rewrite.
"""
