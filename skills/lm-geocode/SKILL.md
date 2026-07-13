---
name: lm-geocode
description: Resolve missing or bad delivery coordinates in bulk — the remediation arm for the missing_delivery_coordinates validation gap. Batches addresses through dispatch_geocode, auto-accepts precise matches, asks about coarse ones, and writes accepted fixes back (with confirmation) or patches the scenario.
argument-hint: "[orders/addresses to geocode]"
---

<!-- GENERATED FILE — do not edit. Source of truth: web-apps/tools/lastmile-plugin (TEI-39). Release: v0.1.3-dev. -->


# /lm-geocode — coordinate remediation

Call `dispatch_schema` first. This workflow exists to close
`missing_delivery_coordinates` gaps and any other "where is this address"
need.

## Batch, never per-address

Collect ALL addresses needing coordinates and call `dispatch_geocode`
once per ≤25 addresses (`geocode_batch_too_large` tells you the cap).
Use each order's name/id as `ref` so results correlate. One call per
sheet — never one call per address; each call is a permission prompt.

## Interpret results

Per-ref results come back in input order:

- `accepted: true` — precise match (HOUSE_NUMBER / POINT_ADDRESS /
  STREET). Safe to use without asking.
- `accepted: false` with a point — coarse match (postal code, city).
  Show the user the address and the match quality; use only if they
  approve.
- `geo_quality: "NO RESULTS"` — no match; ask the user to correct the
  address.
- `error_code: "provider_error"` — transient provider failure for that
  ref only; the rest of the batch is valid. Retry just the failed refs
  once; if it persists, report it.

## Apply the fixes

- **Scenario-sourced orders:** patch the entity arrays and re-run the
  /lm-data validate → load cycle. The coordinates MUST go inside
  `ship_to.location` — `ship_to.lat` / `ship_to.latitude` at the top level
  are ignored by the normalizer and the gap will not clear:

  ```json
  { "id": "ORD-1",
    "ship_to": { "name": "...", "location": { "geo_lat": 30.2755, "geo_lon": -97.7404 } } }
  ```
- **Real LastMile orders:** write back to the source record via
  data-catalog `ship_tos_update` so the gap stays fixed — but ONLY after
  showing the user each ship-to and the exact coordinates to be written
  and getting explicit confirmation (R26). Never mass-write without a
  per-batch confirmation naming every affected record.

After applying, re-validate: the gap list should shrink. If the same gap
recurs, something didn't persist — investigate rather than looping.
