# Design

The product must make people **trust what they see during a stressful moment**. Live mode is
calm and precise; drill mode can carry more personality. The approved mockups (Incident Room,
Seat Picker, Drill Debrief) are the reference for layout and tone.

---

## Tokens

### Live theme
| Token | Value | Use |
|---|---|---|
| `ground` | `#F5F4EF` | Page background |
| `panel` | `#FFFFFF` | Cards and panels |
| `line` | `#E3E0D7` | Borders |
| `ink` | `#1C2128` | Primary text, human decision cards |
| `muted` | `#5A6270` | Secondary text (passes 4.5:1 on white) |
| `accent` | `#2F5D8A` | AI agent markers, primary links, focus |
| `critical` | `#C2490D` | Critical status only (text on light: `#9A3A08`) |
| `atRisk` | `#D08A0B` | At-risk status (fill `#F5E4C0`) |
| `auditor` | `#4A4E8A` | Auditor panel (bg `#F1F0FA`) |

### Drill theme
| Token | Value |
|---|---|
| `ground` | `#11151B` |
| `panel` | `#1A2028` |
| `line` | `#2A323D` |
| `ink` | `#E8ECF1` |
| `muted` | `#9AA5B4` |
| `accent` | `#9CC3EA` |
| `warn` | `#F4B680` |
| `drillBadge` | bg `#2A2340`, text `#CFC4FF` |

### Type
- **IBM Plex Sans** for interface text; **IBM Plex Mono** for identifiers only (batch, lot,
  shipment, incident ids, timestamps). Fallbacks: `'Segoe UI', system-ui, sans-serif` and
  `ui-monospace, monospace`.
- Sentence case everywhere. Labels describe what the thing is in plain words.

## Layout

- Header: product mark, incident id and title, severity pill, Live/Drill switch, sim clock, seat selector.
- Body: left column (your seat, people in the room, live feed), center (voxel world, legend,
  spread path), right column (decision needing you, Decision Board, Auditor).
- Every seat uses the same structure; the seat changes content, not layout.
- Wraps to a single column on phones; the voxel world scrolls inside its own box or switches to the flat map.

## Trust rules

1. AI content carries a small diamond marker and a tinted card; human-confirmed facts do not.
2. Every agent claim shows confidence (bar + word) and source chips that open the original record.
3. Human decision cards have a heavier border and sit at the top of the right column.
4. Color means status only, and every status color is paired with a word or icon.
5. Motion only when something changes (a room becomes affected, a decision arrives). Respect
   `prefers-reduced-motion`.
6. Live mode shows a persistent LIVE marker. Drill mode always uses the drill theme.

## Voxel world

- Isometric cutaway building: back walls only, low dividers between rooms, open front.
- Rooms per `docs/DOMAIN.md` seed. Floors tinted by status: critical (orange), at risk (amber), clear (neutral).
- Workers dressed by role: cleanroom gown + mask (containment), lab coat (investigation, lab),
  hard hat (operations), hi-vis vest (logistics), office wear (regulatory), suit (executive),
  hard hat + blueprint (expansion), magnifier (Auditor).
- Workers walk between rooms when they take on work; handoffs are visible (carrying a folder).
- Incident effects: tinted floor, floating particles, quarantine tape, halted line with amber light,
  held truck with a status pin.
- Clicking a worker opens its agent card; clicking a room opens its details.
- Selecting a seat moves the camera to that department; other rooms dim but stay visible.
- Performance: instanced meshes for repeated items; load after the decision panels; flat-map toggle.

## Saboteurs (drill only)

Original designs; **they must not resemble any existing game characters**.
- **Hunter:** squat red-orange block with a stepped wedge nose, wide pale visor, spiked top.
- **Ambusher:** tall violet body with an eye on a periscope stalk, hugging corners.
- **Flanker:** two teal cubes joined by a bar, each with a slit eye.
- **Wanderer:** a drifting, semi-transparent cluster of gold cubes.
Mode badge: Chase (orange), Scatter (blue), Frightened · reversed (light).

## Copy

Plain verbs, active voice, specific. Buttons say what happens ("Run confirmation swab first",
"Accept now"). Errors explain what happened and how to fix it. Empty states invite the next action.
