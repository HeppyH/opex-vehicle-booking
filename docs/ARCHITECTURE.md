# Architecture and build notes

```text
MyGeotab Portal
  └── Custom Page Add-In (React/Vite, hosted on Cloudflare Pages)
        └── HTTPS API calls
              └── Cloudflare Worker (Hono)
                    ├── Verified identity adapter (must be implemented)
                    ├── Booking / approval / assignment domain
                    ├── MyGeotab adapter (must be tenant validated)
                    └── PostgreSQL via Cloudflare Hyperdrive
```

## Conflict prevention invariant

For a specific vehicle, two active reserved intervals must never overlap. Use half-open intervals `[start, end)` and include configured turnaround buffers. Every assignment/reschedule transaction must:
1. Lock the vehicle row (`SELECT ... FOR UPDATE`).
2. Re-read active reservation slots and active vehicle holds.
3. Reject if any overlap exists.
4. Insert/update the reservation slot and assignment in the same transaction.
5. Commit only once audit/outbox events are written.

Migration `0002_reservation_slots.sql` creates a PostgreSQL GiST exclusion constraint as the final database guard. The application service must populate and deactivate `reservation_slots` consistently with assignment lifecycle. Do not rely on UI availability results.

## Implementation caveat

The starter's API does not yet wire a complete assignment/approval service or a verified Geotab identity adapter. It is a safe foundation and deployment skeleton, not a finished production booking product.
