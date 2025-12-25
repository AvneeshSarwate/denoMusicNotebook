# Piano Roll Integration for Deno Jupyter Notebooks

A reactive, WebSocket-based piano roll integration that allows you to display and edit AbletonClip objects in Deno Jupyter notebooks with bidirectional synchronization.

## Quick Start

### Option 1: Auto-initialization (Easiest)

```typescript
import { clipMap, showMelody, showBoundMelody } from "./pianoRollBridge.ts"
import { AbletonClip, quickNote } from "./copiedHelpers/AbletonClip.ts"

// Create a clip
const clip = new AbletonClip("My Melody", 4, [
  quickNote(60, 1, 100, 0),
  quickNote(64, 1, 100, 1),
  quickNote(67, 1, 100, 2),
])

// Display read-only
showMelody(clip)

// OR: Display editable with ClipMap binding
clipMap.set("myMelody", clip)
showBoundMelody(clipMap, "myMelody")

// Server auto-initializes on first use
```

### Option 2: Explicit initialization (Recommended)

```typescript
import { initializePianoRollBridge, clipMap, showBoundMelody } from "./pianoRollBridge.ts"
import { AbletonClip, quickNote } from "./copiedHelpers/AbletonClip.ts"

// Header cell: Initialize server explicitly
const serverInfo = initializePianoRollBridge()
console.log("Server URL:", serverInfo.baseUrl)
// Output: Server URL: http://127.0.0.1:54321
```

```typescript
// Later cells: Use normally
const clip = new AbletonClip("Test", 4, [
  quickNote(60, 1, 100, 0)
])

clipMap.set("melody", clip)
const handle = showBoundMelody(clipMap, "melody")

// Edit in piano roll → clipMap automatically updates
const editedClip = handle.latestClip
```

## API Reference

### Display Functions

#### `showMelody(clip: AbletonClip): void`
Display a **read-only** piano roll. User cannot edit.

```typescript
showMelody(myClip)
```

#### `showBoundMelody(clipMap: ClipMap, name: string): PianoRollHandle`
Display an **editable** piano roll bound to a ClipMap entry. Changes sync bidirectionally.

```typescript
clipMap.set("melody", myClip)
const handle = showBoundMelody(clipMap, "melody")
```

### ClipMap

Reactive map that syncs changes to all bound piano rolls.

```typescript
// Create (or use global singleton)
import { clipMap } from "./pianoRollBridge.ts"
// OR: const myMap = new ClipMap()

// Set (triggers sync to all bound piano rolls)
clipMap.set("melody", clip)

// Get
const clip = clipMap.get("melody")

// Check existence
if (clipMap.has("melody")) { }

// Delete (disconnects all bound piano rolls)
clipMap.delete("melody")

// Iterate
for (const [name, clip] of clipMap) { }
for (const name of clipMap.keys()) { }
for (const clip of clipMap.values()) { }

// Clear all (disconnects all piano rolls)
clipMap.clear()

// Size
console.log(clipMap.size)
```

### PianoRollHandle

Returned by `showBoundMelody()` for interacting with a specific piano roll.

```typescript
const handle = showBoundMelody(clipMap, "melody")

// Always get the latest edited clip
const currentClip = handle.latestClip

// Update live playhead for visualization
handle.setLivePlayhead(2.5)

// Auto-zoom to show all notes
handle.fitZoomToNotes()

// Disconnect this piano roll
handle.disconnect()
```

### Server Initialization

#### `initializePianoRollBridge(): { baseUrl: string, isNewServer: boolean }`

Optional explicit server initialization. Returns server info.

```typescript
const { baseUrl, isNewServer } = initializePianoRollBridge()
// baseUrl: "http://127.0.0.1:54321"
// isNewServer: true (or false if already running)
```

## Architecture

### Data Flow

```
User Code                    ClipMap                    Piano Rolls
    │                           │                            │
    ├─ set("melody", clip) ────>│──> WebSocket broadcast ──>│ A, B, C
    │                           │                            │
    │<─ handle.latestClip ──────│                            │
    │                           │                            │
    │                           │<── WS: notes edited ───────│ User edits A
    │                           │                            │
    │                           ├──> set() with exclude A ──>│ B, C (synced)
```

### Key Features

- **Reactive synchronization**: `clipMap.set()` automatically updates all bound piano rolls
- **Multi-piano-roll sync**: Multiple piano rolls bound to the same name stay in sync
- **Echo prevention**: Editing piano roll A doesn't echo back to piano roll A
- **Automatic cleanup**: WebSocket disconnect unbinds from ClipMap
- **Server singleton**: Survives notebook cell re-runs via `globalThis`
- **Type-safe**: Full TypeScript typing throughout

### WebSocket Protocol

The bridge uses `PianoRollWebSocketClient` from [pianoRollWebSocketClient.ts](./copiedHelpers/pianoRollWebSocketClient.ts) for bidirectional communication:

**Server → Client:**
- `notesUpdate`: Send updated notes to piano roll
- `stateUpdate`: Send viewport/grid state
- `setConfig`: Update piano roll config (interactive, dimensions)

**Client → Server:**
- `setNotes`: User edited notes in piano roll
- `connectionReady`: Piano roll is ready to receive data

## Advanced Usage

### Multiple Piano Rolls on Same Clip

```typescript
clipMap.set("shared", myClip)

const handle1 = showBoundMelody(clipMap, "shared")
const handle2 = showBoundMelody(clipMap, "shared")

// Editing in either piano roll updates both displays
// and updates clipMap.get("shared")
```

### Live Playhead Visualization

```typescript
clipMap.set("playing", myClip)
const handle = showBoundMelody(clipMap, "playing")

// Animate playhead during playback
let position = 0
const interval = setInterval(() => {
  handle.setLivePlayhead(position)
  position += 0.1
  if (position > 8) position = 0
}, 100)
```

### Algorithmic Composition

```typescript
// Generate notes
const notes = []
for (let i = 0; i < 16; i++) {
  notes.push(quickNote(60 + (i % 8) * 2, 0.25, 100, i * 0.25))
}

const generated = new AbletonClip("Generated", 4, notes)
clipMap.set("algo", generated)
showBoundMelody(clipMap, "algo")

// User can edit generated notes in piano roll
// Access result later:
const editedResult = clipMap.get("algo")
```

### Clip Transformations

```typescript
clipMap.set("melody", baseClip)
showBoundMelody(clipMap, "melody")

// Later: transform and update (will sync to piano roll)
const current = clipMap.get("melody")
if (current) {
  const transformed = current
    .transpose(5)      // Up 5 semitones
    .scale(0.5)        // Half speed
    .loop(2)           // Repeat twice

  clipMap.set("melody", transformed)  // Auto-syncs to piano roll
}
```

## Files

- **[pianoRollBridge.ts](./pianoRollBridge.ts)** - Main bridge implementation (576 lines)
- **[pianoRollUsageExamples.ts](./pianoRollUsageExamples.ts)** - 10 comprehensive examples (295 lines)
- **[copiedHelpers/pianoRollWebSocketClient.ts](./copiedHelpers/pianoRollWebSocketClient.ts)** - WebSocket client for server-side control
- **[copiedHelpers/AbletonClip.ts](./copiedHelpers/AbletonClip.ts)** - Music data structures
- **[copiedHelpers/piano-roll.js](./copiedHelpers/piano-roll.js)** - Bundled web component (356KB)

## Troubleshooting

### Piano roll doesn't display

1. Check console for server initialization message:
   ```
   [PianoRollBridge] Auto-initializing server (first use)...
   [PianoRollBridge] Server running at http://127.0.0.1:54321
   ```

2. Check browser console in iframe for errors

3. Verify bundle path is correct (should be `./copiedHelpers/piano-roll.js`)

### Edits not syncing

1. Verify you're using `showBoundMelody()`, not `showMelody()`
2. Check that `clipMap.set()` was called before `showBoundMelody()`
3. Inspect WebSocket connection in browser DevTools

### Multiple piano rolls out of sync

1. Ensure all piano rolls are bound to the **same** ClipMap instance
2. Verify they're using the **same** clip name
3. Check for errors in server logs

## Technical Details

- **Server**: Deno HTTP server on ephemeral port (auto-assigned)
- **WebSocket**: Bidirectional sync using native Deno WebSockets
- **Component**: Vue 3 web component (`<piano-roll-component>`)
- **State**: Global singleton in `globalThis.__pianoRollBridge__`
- **Note format**: Converted between `AbletonNote` and `NoteDataInput`
- **Cleanup**: Automatic on WebSocket disconnect

## Design Principles

1. **Minimal API surface** - Just ClipMap, showMelody(), showBoundMelody()
2. **No foot-guns** - Only way to break: mutate `clip.notes` without `clipMap.set()`
3. **Automatic reactivity** - No manual push() calls needed
4. **Type-safe** - Full TypeScript throughout
5. **Production-ready** - Handles edge cases, echo prevention, cleanup
