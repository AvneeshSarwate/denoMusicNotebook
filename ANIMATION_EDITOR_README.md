# Animation Editor Integration for Deno Jupyter Notebooks

A WebSocket-based animation editor integration that allows you to create, visualize, and edit multi-track animation timelines directly in Deno Jupyter notebooks.

## Quick Start

```typescript
import {
  trackMap,
  showBoundAnimation,
  initializeAnimationEditorBridge,
  type TrackInput
} from "./tools/animationEditorBridge.ts"

// Initialize server (optional - auto-initializes on first use)
const serverInfo = initializeAnimationEditorBridge()
console.log("Server URL:", serverInfo.baseUrl)
```

```typescript
// Define tracks
const myTracks: TrackInput[] = [
  {
    name: "opacity",
    fieldType: "number",
    data: [
      { time: 0, value: 0 },
      { time: 2, value: 1 },
      { time: 4, value: 0.5 }
    ],
    low: 0,
    high: 1
  },
  {
    name: "state",
    fieldType: "enum",
    data: [
      { time: 0, value: "idle" },
      { time: 2, value: "active" },
      { time: 4, value: "done" }
    ]
  }
]

// Add to trackMap and display editable widget
trackMap.setFromInputs("myAnimation", myTracks)
const handle = showBoundAnimation(trackMap, "myAnimation")
```

## How Callbacks Work

**Important:** Unlike the browser component where callbacks are defined on track definitions, in the notebook context callbacks are registered on the Deno side via the handle.

### The Callback Flow

```
┌─────────────────────┐     WebSocket      ┌─────────────────────┐
│   Deno Notebook     │◄──────────────────►│  Animation Editor   │
│                     │                     │  (in iframe)        │
│  • Stores tracks    │   tracks sync       │                     │
│  • Fires callbacks  │◄──────────────────►│  • Visual editing   │
│  • Controls time    │   bidirectionally   │  • No callbacks     │
└─────────────────────┘                     └─────────────────────┘
```

1. **Track data syncs bidirectionally** - edits in the widget update `trackMap`, and `trackMap.set()` updates the widget
2. **Callbacks live on the Deno side** - you register them via `handle.setCallbacks()`
3. **Callbacks fire when**:
   - You call `handle.scrubToTime(t)` from Deno
   - The widget sends a tracks update (after user edits)

### Registering Callbacks

```typescript
handle.setCallbacks({
  // Called for number tracks - receives interpolated value at current time
  updateNumber: (trackName, value) => {
    console.log(`Number track "${trackName}": ${value}`)
  },

  // Called for enum tracks - receives current step value
  updateEnum: (trackName, value) => {
    console.log(`Enum track "${trackName}": ${value}`)
  },

  // Called for func tracks - receives function name and args
  updateFunc: (trackName, funcName, ...args) => {
    console.log(`Func track "${trackName}": ${funcName}(${args.join(", ")})`)
  }
})
```

### Evaluation Behavior

- **Number tracks**: Linear interpolation between keyframes
- **Enum tracks**: Step function (holds previous value until next keyframe)
- **Func tracks**: Step function (returns most recent function call)

## API Reference

### Display Functions

#### `showAnimationFromInputs(inputs: TrackInput[]): void`
Display a **read-only** animation editor.

```typescript
showAnimationFromInputs([
  { name: "x", fieldType: "number", data: [{ time: 0, value: 0 }] }
])
```

#### `showBoundAnimation(trackMap: TrackMap, name: string): AnimationEditorHandle`
Display an **editable** animation editor bound to a TrackMap entry.

```typescript
trackMap.setFromInputs("anim", myTracks)
const handle = showBoundAnimation(trackMap, "anim")
```

### TrackMap

Reactive map that syncs changes to all bound animation editors.

```typescript
import { trackMap, TrackMap } from "./tools/animationEditorBridge.ts"

// Use global singleton or create your own
const myMap = new TrackMap()

// Set from TrackInput array (generates IDs automatically)
trackMap.setFromInputs("anim", myTracks)

// Or set raw TrackData if you have it
trackMap.set("anim", tracksArray, trackOrderArray)

// Get current tracks
const tracks = trackMap.get("anim")

// Get with track order
const { tracks, trackOrder } = trackMap.getFull("anim")

// Check existence
if (trackMap.has("anim")) { }

// Delete (disconnects bound editors)
trackMap.delete("anim")

// Iterate
for (const [name, tracks] of trackMap) { }

// Clear all
trackMap.clear()
```

### AnimationEditorHandle

Returned by `showBoundAnimation()` for controlling a specific animation editor.

```typescript
const handle = showBoundAnimation(trackMap, "anim")

// Get latest tracks (always current)
const currentTracks = handle.latestTracks

// Register callbacks for track evaluation
handle.setCallbacks({
  updateNumber: (name, val) => { },
  updateEnum: (name, val) => { },
  updateFunc: (name, fn, ...args) => { }
})

// Scrub to time - fires callbacks!
handle.scrubToTime(2.5)

// Set visual playhead (no callbacks)
handle.setLivePlayhead(1.0)

// Get underlying WebSocket client for advanced use
const client = handle.client

// Disconnect this editor
handle.disconnect()
```

### Track Types

#### TrackInput (for creating tracks)

```typescript
interface TrackInput {
  name: string
  fieldType: 'number' | 'enum' | 'func'
  data: (NumberDatumInput | EnumDatumInput | FuncDatumInput)[]
  low?: number   // For number tracks, default 0
  high?: number  // For number tracks, default 1
}

// Number datum
{ time: number, value: number }

// Enum datum
{ time: number, value: string }

// Func datum
{ time: number, funcName: string, args?: unknown[] }
```

## Examples

### Basic Number Animation

```typescript
const fadeAnimation: TrackInput[] = [
  {
    name: "opacity",
    fieldType: "number",
    data: [
      { time: 0, value: 0 },
      { time: 1, value: 1 },
      { time: 3, value: 1 },
      { time: 4, value: 0 }
    ],
    low: 0,
    high: 1
  }
]

trackMap.setFromInputs("fade", fadeAnimation)
const handle = showBoundAnimation(trackMap, "fade")

// Animate with callbacks
handle.setCallbacks({
  updateNumber: (name, value) => {
    if (name === "opacity") {
      console.log(`Opacity: ${(value * 100).toFixed(0)}%`)
    }
  }
})

// Scrub through animation
for (let t = 0; t <= 4; t += 0.5) {
  handle.scrubToTime(t)
  await new Promise(r => setTimeout(r, 100))
}
```

### State Machine with Enum Track

```typescript
const stateMachine: TrackInput[] = [
  {
    name: "playerState",
    fieldType: "enum",
    data: [
      { time: 0, value: "idle" },
      { time: 2, value: "walking" },
      { time: 5, value: "running" },
      { time: 8, value: "idle" }
    ]
  },
  {
    name: "speed",
    fieldType: "number",
    data: [
      { time: 0, value: 0 },
      { time: 2, value: 1 },
      { time: 5, value: 3 },
      { time: 8, value: 0 }
    ],
    low: 0,
    high: 5
  }
]

trackMap.setFromInputs("player", stateMachine)
const handle = showBoundAnimation(trackMap, "player")

handle.setCallbacks({
  updateEnum: (name, value) => {
    if (name === "playerState") {
      console.log(`State changed to: ${value}`)
    }
  },
  updateNumber: (name, value) => {
    if (name === "speed") {
      console.log(`Speed: ${value.toFixed(1)}`)
    }
  }
})
```

### Function Triggers

```typescript
const triggers: TrackInput[] = [
  {
    name: "events",
    fieldType: "func",
    data: [
      { time: 0, funcName: "start", args: [] },
      { time: 2, funcName: "playSound", args: ["beep.wav", 0.8] },
      { time: 4, funcName: "spawnParticles", args: [100, "fire"] },
      { time: 6, funcName: "end", args: [] }
    ]
  }
]

trackMap.setFromInputs("triggers", triggers)
const handle = showBoundAnimation(trackMap, "triggers")

handle.setCallbacks({
  updateFunc: (trackName, funcName, ...args) => {
    console.log(`Trigger: ${funcName}(${args.join(", ")})`)

    // Dispatch to actual functions
    switch (funcName) {
      case "playSound":
        // playSound(args[0], args[1])
        break
      case "spawnParticles":
        // spawnParticles(args[0], args[1])
        break
    }
  }
})
```

### Live Playhead Animation

```typescript
trackMap.setFromInputs("anim", myTracks)
const handle = showBoundAnimation(trackMap, "anim")

// Animate playhead in real-time
let position = 0
const interval = setInterval(() => {
  handle.setLivePlayhead(position)
  position += 0.1
  if (position > 8) position = 0
}, 100)

// Stop with: clearInterval(interval)
```

### Reading Edited Tracks

```typescript
trackMap.setFromInputs("editable", myTracks)
const handle = showBoundAnimation(trackMap, "editable")

// User edits in widget...

// Later: read the edited tracks
const editedTracks = handle.latestTracks
console.log("Track count:", editedTracks?.length)

// Or get from trackMap directly
const fromMap = trackMap.get("editable")
```

## Files

- **[tools/animationEditorBridge.ts](./tools/animationEditorBridge.ts)** - Main bridge implementation
- **[copiedHelpers/animationEditorWebSocketClient.ts](./copiedHelpers/animationEditorWebSocketClient.ts)** - WebSocket client
- **[copiedHelpers/animation-editor.js](./copiedHelpers/animation-editor.js)** - Bundled web component (384KB)

## Architecture

### Data Flow

```
User Code                    TrackMap                   Animation Editors
    │                           │                            │
    ├─ setFromInputs() ────────►│──► WebSocket broadcast ──►│ A, B, C
    │                           │                            │
    │◄─ handle.latestTracks ────│                            │
    │                           │                            │
    │                           │◄── WS: tracks edited ──────│ User edits A
    │                           │                            │
    │                           ├──► set() with exclude A ──►│ B, C (synced)
    │                           │                            │
    ├─ handle.scrubToTime(t) ──►│                            │
    │  (fires callbacks)        │                            │
```

### Key Differences from Browser Component

| Aspect | Browser Component | Notebook Integration |
|--------|-------------------|---------------------|
| Callbacks | Defined on TrackDef | Registered via handle.setCallbacks() |
| Evaluation | Component evaluates internally | Deno client evaluates & fires callbacks |
| Data ownership | Component owns state | TrackMap owns state, syncs to component |
| Playback | Component can scrub | Notebook controls scrubbing |

## Troubleshooting

### Widget doesn't display

1. Check console for server initialization:
   ```
   [AnimationEditorBridge] Server running at http://0.0.0.0:XXXXX
   ```
2. Verify bundle exists: `copiedHelpers/animation-editor.js`

### Callbacks not firing

1. Make sure you called `handle.setCallbacks()` before scrubbing
2. Verify you're using `handle.scrubToTime()` not just `setLivePlayhead()`
3. Check that tracks have data at the time you're scrubbing to

### Edits not syncing

1. Use `showBoundAnimation()` not `showAnimationFromInputs()` for editable widgets
2. Ensure the animation name exists in trackMap before calling `showBoundAnimation()`

### Multiple editors out of sync

1. Ensure all editors are bound to the same TrackMap instance
2. Verify they use the same animation name
