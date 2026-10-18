# Flight13 design concepts

Original, hand-drawn SVG mockups for proposed next-level upgrades. The logo mark and route
arcs in `apps/web/src/components/art/` are invented for Flight13; all photography is real,
freely-licensed imagery from Wikimedia Commons served through the site settings API (admins
can override every image in the admin console → Appearance).

| File                  | Concept                                                                                                                                                                                                                       | Status          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `chama-pay.svg`       | **Chama Pay** — group contributory M-Pesa funding: several people STK-push toward one booking, live progress ring, seat-hold-matched TTL, auto-confirm on target, automatic split refunds on expiry. No airline app has this. | Proposed (M11+) |
| `safari-passport.svg` | **Safari Passport** — collectible per-route stamps minted after completed segments, streak ribbons and rarity tiers. Designed as ink-stamp art, off-chain.                                                                    | Proposed (M11+) |
| `captains-log.svg`    | **Captain's Log** — a narrated, live flight story feed (real milestones told as prose), plus **Gate Wisdom**: the crowd's predicted departure bar shown next to the official time.                                            | Proposed (M11+) |

The production brand system ships in `apps/web/src/components/art/` (dart mark / route arcs /
boarding-pass ticket band) and `apps/web/src/app/icon.svg`. Destination cards, the home hero,
the auth banner, empty states and the 404 page render real photographs of the actual places
(Nairobi, Maasai Mara, Kisumu, Eldoret, Malindi, Lamu, Entebbe, Dar es Salaam, Johannesburg,
Dubai, London, Wilson Airport) — defaults in `apps/web/src/lib/site-images.ts`, overridable per
key by admins. The active colour theme (`sky`, `savanna`, `ocean`, `forest`, `midnight`) is a
`data-theme` attribute on `<html>`, also switched from the admin console.
