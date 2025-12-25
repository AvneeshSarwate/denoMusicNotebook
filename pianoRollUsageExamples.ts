/**
 * Piano Roll Bridge - Usage Examples
 *
 * This file contains example code for using the piano roll integration
 * in Deno Jupyter notebooks.
 */

import {
  clipMap,
  showMelody,
  showBoundMelody,
  PianoRollHandle,
  initializePianoRollBridge
} from "./pianoRollBridge.ts"
import { AbletonClip, quickNote } from "./copiedHelpers/AbletonClip.ts"

// ============================================================================
// Example 0: Optional Header Cell - Explicit Server Initialization
// ============================================================================

// OPTIONAL: Initialize the server explicitly in a header cell
// This gives you visibility into when the server starts and what port it uses.
// If you skip this, the server will auto-initialize on first piano roll display.

const serverInfo = initializePianoRollBridge()
console.log("Piano Roll Server URL:", serverInfo.baseUrl)
console.log("Is new server:", serverInfo.isNewServer)

// Output example:
// [PianoRollBridge] Initializing server...
// [PianoRollBridge] Server running at http://127.0.0.1:54321
// Piano Roll Server URL: http://127.0.0.1:54321
// Is new server: true

// If you re-run this cell:
// [PianoRollBridge] Server already running
// Piano Roll Server URL: http://127.0.0.1:54321
// Is new server: false

// ============================================================================
// Example 1: Display a read-only piano roll
// ============================================================================

// Create a simple melody
const simpleClip = new AbletonClip("Simple Melody", 4, [
  quickNote(60, 0.5, 100, 0),    // C
  quickNote(62, 0.5, 100, 0.5),  // D
  quickNote(64, 0.5, 100, 1),    // E
  quickNote(65, 0.5, 100, 1.5),  // F
  quickNote(67, 1, 100, 2),      // G
])

// Display as read-only (user cannot edit)
showMelody(simpleClip)

// ============================================================================
// Example 2: Display an editable piano roll with ClipMap binding
// ============================================================================

// Create a clip and add it to the ClipMap
const editableClip = new AbletonClip("Editable Melody", 8, [
  quickNote(64, 1, 100, 0),     // E
  quickNote(62, 1, 100, 1),     // D
  quickNote(60, 1, 100, 2),     // C
  quickNote(62, 1, 100, 3),     // D
  quickNote(64, 1, 100, 4),     // E
  quickNote(64, 1, 100, 5),     // E
  quickNote(64, 2, 100, 6),     // E (longer)
])

clipMap.set("myMelody", editableClip)

// Display editable piano roll
const handle = showBoundMelody(clipMap, "myMelody")

// ============================================================================
// Example 3: Working with the handle to access edited clips
// ============================================================================

// Later in your code, access the edited clip
const currentClip = handle.latestClip
console.log("Current notes:", currentClip?.notes)

// Update the clip programmatically (will sync to piano roll)
if (currentClip) {
  // Transpose up by 2 semitones
  const transposed = currentClip.transpose(2)
  clipMap.set("myMelody", transposed)
}

// Clean up when done
handle.disconnect()

// ============================================================================
// Example 4: Multiple piano rolls bound to the same clip
// ============================================================================

// Both piano rolls will stay in sync
clipMap.set("sharedMelody", new AbletonClip("Shared", 4, [
  quickNote(60, 1, 100, 0),
  quickNote(64, 1, 100, 1),
  quickNote(67, 1, 100, 2),
  quickNote(72, 1, 100, 3),
]))

const handle1 = showBoundMelody(clipMap, "sharedMelody")
const handle2 = showBoundMelody(clipMap, "sharedMelody")

// Editing in either piano roll will update both displays
// and update clipMap.get("sharedMelody")

// ============================================================================
// Example 5: Live playhead visualization
// ============================================================================

// Set up a clip
clipMap.set("playingMelody", new AbletonClip("Playing", 8, [
  quickNote(60, 0.5, 100, 0),
  quickNote(62, 0.5, 100, 1),
  quickNote(64, 0.5, 100, 2),
  quickNote(65, 0.5, 100, 3),
]))

const playHandle = showBoundMelody(clipMap, "playingMelody")

// Simulate playback by updating playhead position
let position = 0
const playbackInterval = setInterval(() => {
  playHandle.setLivePlayhead(position)
  position += 0.1
  if (position > 8) {
    position = 0
  }
}, 100)

// Stop playback after 10 seconds
setTimeout(() => {
  clearInterval(playbackInterval)
  playHandle.disconnect()
}, 10000)

// ============================================================================
// Example 6: ClipMap reactivity
// ============================================================================

// Set initial clip
clipMap.set("reactive", new AbletonClip("Reactive", 4, [
  quickNote(60, 1, 100, 0),
]))

const reactiveHandle = showBoundMelody(clipMap, "reactive")

// Update the clip - piano roll will automatically update
setTimeout(() => {
  const newClip = new AbletonClip("Updated", 4, [
    quickNote(60, 1, 100, 0),
    quickNote(64, 1, 100, 1),
    quickNote(67, 1, 100, 2),
    quickNote(72, 1, 100, 3),
  ])
  clipMap.set("reactive", newClip)
}, 2000)

// ============================================================================
// Example 7: Advanced clip manipulation
// ============================================================================

// Create a base pattern
const basePattern = new AbletonClip("Base", 2, [
  quickNote(60, 0.5, 100, 0),
  quickNote(64, 0.5, 100, 0.5),
  quickNote(67, 0.5, 100, 1),
  quickNote(64, 0.5, 100, 1.5),
])

// Loop it 4 times
const loopedPattern = basePattern.loop(4)

// Add to ClipMap
clipMap.set("pattern", loopedPattern)
showBoundMelody(clipMap, "pattern")

// Later: manipulate and update
setTimeout(() => {
  // Get current version (may have been edited in piano roll)
  const current = clipMap.get("pattern")

  if (current) {
    // Transpose and time-stretch
    const transformed = current.transpose(5).scale(0.5)
    clipMap.set("pattern", transformed)
  }
}, 5000)

// ============================================================================
// Example 8: Creating clips from scratch in the UI
// ============================================================================

// Start with an empty clip
const emptyClip = new AbletonClip("Empty", 8, [])
clipMap.set("fromScratch", emptyClip)

const emptyHandle = showBoundMelody(clipMap, "fromScratch")

// User can now draw notes in the piano roll
// Access the result later:
setTimeout(() => {
  const userCreated = emptyHandle.latestClip
  console.log("User created:", userCreated?.notes.length, "notes")
}, 10000)

// ============================================================================
// Example 9: Using with algorithmic composition
// ============================================================================

import { launch } from "./copiedHelpers/offline_time_context.ts"

// Generate notes algorithmically
function generatePattern(startPitch: number, length: number): AbletonClip {
  const notes = []
  for (let i = 0; i < length; i++) {
    const pitch = startPitch + (i % 8) * 2  // Scale pattern
    notes.push(quickNote(pitch, 0.25, 100, i * 0.25))
  }
  return new AbletonClip("Generated", length * 0.25, notes)
}

// Generate and display
const generated = generatePattern(60, 16)
clipMap.set("generated", generated)
showBoundMelody(clipMap, "generated")

// ============================================================================
// Example 10: Cleaning up multiple handles
// ============================================================================

const handles: PianoRollHandle[] = []

// Create multiple piano rolls
for (let i = 0; i < 5; i++) {
  const clip = new AbletonClip(`Clip ${i}`, 4, [
    quickNote(60 + i * 2, 1, 100, 0),
    quickNote(64 + i * 2, 1, 100, 1),
  ])
  clipMap.set(`clip${i}`, clip)
  handles.push(showBoundMelody(clipMap, `clip${i}`))
}

// Clean up all at once
setTimeout(() => {
  handles.forEach(h => h.disconnect())
}, 30000)

// ============================================================================
// Implementation Notes
// ============================================================================

/**
 * SERVER INITIALIZATION:
 *
 * The HTTP/WebSocket server can be initialized in two ways:
 *
 * 1. Automatic (default):
 *    - Server auto-starts on first call to showMelody() or showBoundMelody()
 *    - Console log: "[PianoRollBridge] Auto-initializing server (first use)..."
 *
 * 2. Explicit (recommended):
 *    - Call initializePianoRollBridge() in a header cell
 *    - Gives you the server URL and control over initialization timing
 *    - Useful for debugging and avoiding delays on first piano roll display
 *
 * The server singleton survives cell re-runs via globalThis.__pianoRollBridge__.
 *
 * ---
 *
 * WEB COMPONENT STRUCTURE:
 *
 * The piano-roll.js bundle is a web component that auto-registers itself
 * as <piano-roll-component> when loaded. It accepts these attributes:
 *
 * - ws-address: WebSocket URL for bidirectional sync
 * - interactive: "true" | "false" - whether editing is enabled
 * - show-control-panel: "true" | "false" - show UI controls
 * - width: pixel width
 * - height: pixel height
 *
 * The component provides these methods (when not using WebSocket):
 * - setNotes(notes): Set notes array
 * - fitZoomToNotes(): Auto-zoom to show all notes
 * - getPlayStartPosition(): Get queue playhead position
 * - setLivePlayheadPosition(pos): Set live playhead for visualization
 *
 * When using WebSocket (as in this bridge), the component handles
 * bidirectional sync automatically via the ws-address attribute.
 */
