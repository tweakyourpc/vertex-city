# Walkable building milestone

This development milestone adds seamless entry to selected buildings, furnished
rooms, stairs, moving elevators, window views, rooftop gardens, seating, surface
backing, and an empty-city toggle. All generated building details are SIMULATED.
It does not claim to reconstruct actual private interiors.

## Explore

Load **Demo City (offline)**. A fresh view starts just outside **Lantern Books**.
Press **R** to open its entrance, then walk forward. The shelves and bench are
on the ground floor; the stairs are at the back left and the elevator is at the
back right. Civic Atelier is the second demonstration building nearby.

Walk into the elevator, choose a destination in the HUD, and press **GO**.
The doors slide closed, the cabin carries you continuously, and the doors reopen
at the destination. To call a cabin from another floor, approach the landing
and press **R**. Stairs also connect every floor to the roof. On the roof, walk
out of the lift to reach the garden and lookout bench. Approach a bench from
its open side and press **R** to sit; press R or a movement key to stand.

Windows share the actual room geometry. You can look into the room from outside
and look out at the current street scene from inside. Window glass blocks the
player; frames, furniture, walls, and floors occlude the view. Click a surface
or object to identify it in the exploration HUD. Weather particles are suppressed
while the player is inside an enclosed building.

**SURFACE BACKING** toggles dark material backing in ASCII mode. **EMPTY CITY**
pauses and hides simulated ground traffic and pedestrians, preserving the prior
traffic setting. Observational layers retain their separate controls. Existing
G, T, P, Q/E, and V bindings are retained. QUALITY applies to all three modes;
font size follows the cell scale while the DOM HUD remains independently sized.

## Geometry and collision contract

- `Interiors` owns a spatial index, stable descriptors, at most eight active
  building layouts, and a separate bounded session cache of 128 interaction states.
- Real-city eligibility is deliberately conservative: one axis-aligned rectangular
  ring, 5.5-85 cells per side, positive supported height, consistent ownership,
  and an unobstructed approach to a street/path. Irregular, overlapping, and
  courtyard footprints remain exterior-only. Suitable uniform-height procedural
  blocks use seed/coordinate identities and retain the original footprint.
- Local box geometry supplies both rendering and collision. OSM identities use
  `type/id`, never transient raster IDs. Nearby detailed footprints are skipped
  by the height-field wall pass and replaced with depth-tested box faces.
- Near-plane clipping precedes projection; triangle depth is perspective-correct.
  Glass is a collider with no opaque face. Window frames are real geometry.
- Structural slabs exist on every floor. Only the current and adjacent floors
  generate detailed furnishings and stair treads. Distant window decoration is
  intentionally reduced. Layouts regenerate deterministically after eviction.
- Support is queried relative to the player's feet. Roof-height collision cannot
  be reused for rooms. Stair support and body collision use the same horizontal
  radius; tread undersides follow the rise to preserve headroom.
- Elevator movement carries an aboard player by exactly the cabin's height delta.
  Landing doors stay closed when the cabin is absent. Occupied thresholds hold
  departure. Cabin movement is independent of time warp and live providers.
- Streamed geometry replacement is deferred while indoors. Keep only the latest
  pending snapshot, discard it on city changes, and clear it when a newer snapshot
  is applied. Compatible door/lift state rebinds by stable ID after reprojection.

## Checks

`npm run check` covers lint and hermetic tests. `npm run benchmark` now includes
entrance, furnished-room, and roof scenarios and reports the interior phase.
Node composition timings use a stub Canvas and do not measure real GPU work.

A reusable Chrome check runs the actual application, checks entry and elevator
travel, switches rendering modes, exercises empty city, captures temporary
screenshots, samples frame intervals, and reports browser exceptions:

```bash
node tools/browser-exploration.mjs "$APP_URL" /tmp/ascii-city-preview
```

Set APP_URL to the running application's URL. Chrome must be installed, or set
CHROME_BIN to its executable. The check uses a private CDP pipe and blocks
external HTTPS requests. Screenshots remain temporary verification artifacts.

The 1280×720 headless Chrome sample before the final shelf-detail pass showed
16.7 ms median and 33.4 ms p95 frame intervals on the development machine.
This is a local sample, not integrated-laptop certification or a ten-minute
memory soak. Live multi-tile streaming and a real reference laptop remain
release-validation work.

## Later milestones

Not implemented by this first milestone: auto-tour/pathfinding, additional vehicle
classes and occupants, cyclists, pedestrian crossing logic, richer street objects,
and the redesigned visible traffic signals. Existing traffic signal timing remains
active; its old pole renderer remains opt-in. Flying cars are excluded by choice.

The next implementation step is bounded local pedestrian routing using the shared
collision geometry, followed by auto-tour destinations and indoor circulation.
Do not claim the complete roadmap is delivered with the indoor milestone.
