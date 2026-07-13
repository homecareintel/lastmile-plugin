<!-- GENERATED FILE — do not edit. Source of truth: web-apps/tools/lastmile-plugin (TEI-39). Release: v0.1.2. -->

# /lm-data input contract

What `dispatch_load_scenario` accepts when you bring your own data
(spreadsheet, CSV, Google Doc table, pasted rows). The server normalizers
are tolerant of common field-name variants — you don't have to rename
your columns.

## Entities

**Orders** (required, ≥1):

| Field | Accepted names / shape |
|---|---|
| id | `id` or `order_header_id` |
| pickup terminal | `pickup_location_id` (or `pickup_location_ids` array) — must match a depot id |
| ship-to | `ship_to: { name, location }` |
| coordinates | **must be nested inside `ship_to.location`** (top-level `ship_to.lat` is ignored): `geo_lat` / `lat` / `latitude` + `geo_lon` / `lng` / `longitude` |
| address (if no coordinates) | `address1` / `address` / `full_address` / `street`, plus `city`, `state`, `postal_code` / `postalCode` / `zip` — resolve via `/lm-geocode` |
| items | `order_items: [{ product_id, quantity }]` — must be non-empty |

**Shifts** (≥1): `id`, `resource` (driver), `schedule_date`, `vehicle`
with `tanks` (capacity).

**Depots/terminals** (≥1): `id`, `name`, `location` (coordinates as
above), `terminal_products: [{ product_id }]`.

## Limits

- **500 rows** total (orders + shifts + depots) and **~350 KB** of JSON
  per load. Oversized input fails fast with the structured
  `scenario_too_large` error naming the limits — split the sheet or trim
  unused columns.
- Geocode batches: 25 addresses per `dispatch_geocode` call.

## Validation gaps you'll see

| code | meaning | fix |
|---|---|---|
| `missing_delivery_coordinates` | no usable lat/lng on a ship-to | `/lm-geocode` |
| `missing_pickup_terminal` | order's pickup doesn't match a depot | fix the id or add the depot |
| `no_order_items` | empty items array | add `{product_id, quantity}` rows |
| `no_orders_selected` / `no_resources_selected` / `no_terminals` | an entity array is empty | supply the missing entities |

Validation is a free dry-run: `validate_only: true` writes nothing.
