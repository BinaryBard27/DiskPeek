# DiskBuddy reverse-engineering report

Date: 2026-10-25 (Asia/Calcutta)
Target: https://diskbuddy.com/
Scope: publicly reachable website, rendered DOM, public feature pages, metadata, and privacy disclosures. No purchase, account, private API access, or desktop binary was used.

## Executive summary

DiskBuddy is presented as a local-first disk analysis and cleanup product for macOS, with a Windows build advertised as well. Its user model is a single scan feeding nine functional “rooms”: Overview, Find, Space, Cleanup, Duplicates, Applications, Monitor, Compress, and Activity.

The website itself is a Next.js application using streamed React Server Components and Turbopack-generated chunks. It contains interactive, deterministic feature demos (for example, the Find page), but those demos are not evidence of the desktop implementation. The actual scanner, indexer, filesystem actions, hashing, monitoring, compression, licensing client, and native UI remain unobserved without the shipped app.

## Product model observed

### Core scan/index pipeline

- A full-disk scan is claimed to map the drive, classify contents, rank large files/folders, and identify cleanup candidates.
- The site claims roughly 10 seconds for a typical full scan on Apple silicon and roughly 20 seconds to build a multi-million-file Find index.
- Find is described as a filename/folder-name index covering hidden folders, Library folders, app contents, and system folders, with in-memory search and filesystem change tracking.
- Space presents a treemap/card view and ranked lists. The inspector exposes logical size, size on disk, item counts, parent share, compression, and dates.

### Cleanup safety model

- Cleanup is staged: the user reviews selected items before action.
- The stated destructive boundary is moving items to the system Trash, not permanent deletion.
- A whole-cleanup Undo is advertised.
- “Safe to clear” groups include caches, logs, dependency folders, build output, package caches, simulator data, and similar rebuildable artifacts.
- “Worth a look” items such as downloads, disk images, and media are separated for explicit user choice.
- The site says recognized cleanup candidates are identified using more than filename matching, but the exact rule engine is not public.

### Duplicates

- The claimed algorithm is: group by size, use a partial read to narrow candidates, then confirm with a full SHA-256 hash.
- APFS clones are claimed to be recognized and excluded because removing one would not reclaim storage.
- Duplicate removal is staged into the same cleanup queue rather than performed immediately.

### Applications

- An app’s footprint includes its bundle plus associated caches, containers, preferences, logs, and support folders.
- The site advertises complete uninstall, orphan/leftover discovery, app update information from app-provided feeds or Homebrew, login items, and background agents.
- A 24-hour app activity view is advertised, including CPU, memory, disk I/O, network hosts, and open files.

### Monitor and compression

- Monitor is described as reading CPU, memory pressure/swap, network, storage, battery, listening ports, and process activity.
- Listening ports have a Stop action; the site claims only processes owned by the user can be stopped.
- A menu-bar popover is advertised.
- Compress supports video and image workflows, hardware-assisted video encoding, target size or quality presets, resizing, format conversion, previews, and optional removal of originals to Trash.

### Activity and snapshots

- Activity records scans, cleanups, uninstalls, and compressions locally, with weekly reclaimed-space totals and a timeline.
- The FAQ describes Snapshots as saved past scan results used to compare folder growth over time.

## Website architecture observed

- Framework indicators: `/_next/` static chunks, React Server Component payloads in `self.__next_f`, a route segment shaped like `features/[room]`, and a Turbopack runtime chunk.
- The rendered page uses client-side interactivity for feature demos, FAQ disclosure, theme controls, and the Find demo.
- Fonts/classes expose Marlin, Familjen Grotesk, National Park, and Roboto Mono families.
- Analytics/measurement integrations observed in the page payload: Vercel Web Analytics, Google Analytics (`G-5S8N8M6Q9V`), and Piqo (`data-site="49iklpt9"`, `data-domain="diskbuddy.com"`).
- Public links expose checkout, license recovery, license-status, privacy, terms, feature, guide, and download routes. The checkout destination is not followed because it would leave the public product surface and could initiate a purchase flow.
- The Find demo is interactive but synthetic: entering `node` produced three example `node_modules` results and a displayed “3 found in 2 ms, across 3,104,882 files.” This demonstrates UI behavior and copy, not access to a real local filesystem.

## Privacy/licensing architecture claimed by the site

- File names, paths, contents, hashes, and sizes are claimed to remain on the user’s Mac.
- The app is claimed to have no account, sync, or product analytics.
- The privacy page says licensing requests include the license key, an installation identifier, and the Mac name; offline operation is claimed for up to two weeks after a failed check.
- Checkout is described as Stripe-backed; the merchant stores purchase email, license key, Stripe reference, and dates, and uses Amazon SES for delivery/recovery email.
- The website itself does use analytics, so “local only” applies to the desktop product’s file data, not to the marketing site’s visit telemetry.

## Findings ledger

| Finding | Type | Confidence | Basis |
|---|---|---:|---|
| Nine-room product model | Observation | High | Homepage and nine public feature routes |
| Staged-to-Trash cleanup model | Observation | High | Homepage, Cleanup, Duplicates, Applications pages |
| Full SHA-256 duplicate confirmation | Observation/claimed implementation | Medium | Public Duplicates page; no binary or runtime verification |
| In-memory filename index with change tracking | Observation/claimed implementation | Medium | Public Find page; no runtime filesystem probe |
| Next.js + streamed RSC + Turbopack website | Observation | High | Rendered scripts, `/\_next/` assets, `self.__next_f` payload |
| File data stays local to the desktop app | Product claim | Medium | Privacy page; not independently verified |
| Website analytics present | Observation | High | Rendered script sources and RSC payload |
| Desktop implementation is native | Product claim | Medium | Homepage copy says “native Mac app”; no binary inspection |

## Unknowns and limits

- No public desktop installer/binary was available without purchasing, so native code, package format, signing, update mechanism, filesystem permissions, database schema, IPC, crash behavior, and actual cleanup implementation are unknown.
- The public demos may be hard-coded or simulated; they do not establish that the desktop app produces identical values or uses the same data structures.
- The website currently rendered a $9 launch price, while some cached search extracts showed $19. Pricing should be treated as time-sensitive and verified from the live page before use.
- Claims about performance, privacy, APFS clone handling, ownership checks, and two-week offline licensing are publisher claims until corroborated against a shipped artifact or controlled runtime observation.

## Most useful next evidence

1. Obtain an authorized installer or app bundle for static package and binary inspection.
2. Run the app in an isolated test environment with a disposable fixture tree.
3. Capture scan, cleanup staging, Trash move, Undo, duplicate matching, licensing, and update flows.
4. Compare runtime network activity with the privacy-page claims, excluding user file contents from any capture.

## Public evidence

- Homepage: https://diskbuddy.com/
- Overview: https://diskbuddy.com/features/overview
- Find: https://diskbuddy.com/features/find
- Space: https://diskbuddy.com/features/space
- Cleanup: https://diskbuddy.com/features/cleanup
- Duplicates: https://diskbuddy.com/features/duplicates
- Applications: https://diskbuddy.com/features/apps
- Monitor: https://diskbuddy.com/features/monitor
- Compress: https://diskbuddy.com/features/compress
- Activity: https://diskbuddy.com/features/activity
- Privacy: https://diskbuddy.com/privacy
