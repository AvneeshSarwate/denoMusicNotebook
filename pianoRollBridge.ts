/**
 * Piano Roll Bridge - Deno Jupyter Notebook Integration
 *
 * Provides reactive piano roll visualization for AbletonClip objects.
 * Uses HTTP+WebSocket bridge to sync state between kernel and browser.
 *
 * Usage:
 * ```typescript
 * import { clipMap, showMelody, showBoundMelody } from "./pianoRollBridge.ts"
 *
 * // Read-only display
 * showMelody(myClip)
 *
 * // Reactive binding
 * clipMap.set("melody", myClip)
 * const handle = showBoundMelody(clipMap, "melody")
 * // Edit in UI -> clipMap automatically updated
 * const edited = handle.latestClip
 * ```
 */

import {
  PianoRollWebSocketClient,
  type NoteDataInput,
  type NoteData
} from "./copiedHelpers/pianoRollWebSocketClient.ts"
import { AbletonClip, type AbletonNote } from "./copiedHelpers/AbletonClip.ts"

// ============================================================================
// Type Definitions
// ============================================================================

interface SessionData {
  type: 'readonly' | 'bound'
  // For readonly sessions
  clip?: AbletonClip
  // For bound sessions
  clipMap?: ClipMap
  clipName?: string
  // Both types
  client?: PianoRollWebSocketClient
}

interface Bridge {
  server: Deno.HttpServer
  baseUrl: string
  sessions: Map<string, SessionData>
  bundlePath: string
}

export interface PianoRollHandle {
  /** Always reads the latest clip from the ClipMap */
  readonly latestClip: AbletonClip | undefined
  /** Close this piano roll session */
  disconnect(): void
  /** Update the live playhead position */
  setLivePlayhead(position: number): void
  /** Fit zoom to show all notes */
  fitZoomToNotes(): void
}

// ============================================================================
// Note Conversion Functions
// ============================================================================

/**
 * Convert AbletonNote array to piano roll NoteDataInput format.
 * Generates unique IDs for each note.
 */
function abletonToNoteData(notes: AbletonNote[]): NoteDataInput[] {
  return notes.map((note, index) => ({
    id: `note_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 9)}`,
    pitch: note.pitch,
    position: note.position,
    duration: note.duration,
    velocity: note.velocity
  }))
}

/**
 * Convert piano roll NoteData array back to AbletonNote format.
 * Uses default values for fields not in piano roll (offVelocity, probability, isEnabled).
 */
function noteDataToAbleton(notes: readonly NoteData[]): AbletonNote[] {
  return notes.map(note => ({
    pitch: note.pitch,
    position: note.position,
    duration: note.duration,
    velocity: note.velocity,
    offVelocity: note.velocity, // Default: same as velocity
    probability: 1,              // Default: always play
    isEnabled: true,             // Default: enabled
    metadata: note.metadata
  }))
}

// ============================================================================
// ClipMap - Reactive Map with Piano Roll Sync
// ============================================================================

/**
 * Reactive Map that automatically syncs changes to all bound piano rolls.
 *
 * When you call `set(name, clip)`, all piano rolls bound to that name
 * will update automatically. Piano roll edits also update the map.
 */
export class ClipMap {
  private clips = new Map<string, AbletonClip>()
  private bindings = new Map<string, Set<string>>() // clipName -> Set<sessionId>

  /**
   * Get a clip by name.
   */
  get(name: string): AbletonClip | undefined {
    return this.clips.get(name)
  }

  /**
   * Check if a clip exists.
   */
  has(name: string): boolean {
    return this.clips.has(name)
  }

  /**
   * Set a clip and notify all bound piano rolls.
   * @param name - Clip name
   * @param clip - AbletonClip to set
   * @param options - Optional settings (e.g., excludeSession to prevent echo)
   */
  set(name: string, clip: AbletonClip, options?: { excludeSession?: string }): this {
    this.clips.set(name, clip)

    // Notify all piano rolls bound to this clip name
    const sessions = this.bindings.get(name)
    if (sessions) {
      for (const sessionId of sessions) {
        if (sessionId === options?.excludeSession) {
          continue // Skip the session that triggered this update (prevent echo)
        }

        const bridge = getBridge()
        const session = bridge.sessions.get(sessionId)
        if (session?.client?.connected) {
          const notes = abletonToNoteData(clip.notes)
          session.client.setNotes(notes)
        }
      }
    }

    return this
  }

  /**
   * Delete a clip and disconnect all bound piano rolls.
   */
  delete(name: string): boolean {
    const sessions = this.bindings.get(name)
    if (sessions) {
      const bridge = getBridge()
      for (const sessionId of sessions) {
        const session = bridge.sessions.get(sessionId)
        session?.client?.disconnect()
        bridge.sessions.delete(sessionId)
      }
      this.bindings.delete(name)
    }
    return this.clips.delete(name)
  }

  /**
   * Get all clip names.
   */
  keys(): IterableIterator<string> {
    return this.clips.keys()
  }

  /**
   * Get all clips.
   */
  values(): IterableIterator<AbletonClip> {
    return this.clips.values()
  }

  /**
   * Get all [name, clip] entries.
   */
  entries(): IterableIterator<[string, AbletonClip]> {
    return this.clips.entries()
  }

  /**
   * Iterate over [name, clip] entries.
   */
  [Symbol.iterator](): IterableIterator<[string, AbletonClip]> {
    return this.clips[Symbol.iterator]()
  }

  /**
   * Number of clips in the map.
   */
  get size(): number {
    return this.clips.size
  }

  /**
   * Clear all clips and disconnect all piano rolls.
   */
  clear(): void {
    const bridge = getBridge()
    // Disconnect all sessions
    for (const sessions of this.bindings.values()) {
      for (const sessionId of sessions) {
        const session = bridge.sessions.get(sessionId)
        session?.client?.disconnect()
        bridge.sessions.delete(sessionId)
      }
    }
    this.bindings.clear()
    this.clips.clear()
  }

  /**
   * Internal: Bind a session to a clip name.
   * Called by showBoundMelody when creating a new piano roll.
   */
  bind(clipName: string, sessionId: string): void {
    if (!this.bindings.has(clipName)) {
      this.bindings.set(clipName, new Set())
    }
    this.bindings.get(clipName)!.add(sessionId)
  }

  /**
   * Internal: Unbind a session from a clip name.
   * Called when a piano roll disconnects.
   */
  unbind(clipName: string, sessionId: string): void {
    const sessions = this.bindings.get(clipName)
    if (sessions) {
      sessions.delete(sessionId)
      if (sessions.size === 0) {
        this.bindings.delete(clipName)
      }
    }
  }
}

// ============================================================================
// Bridge Singleton Management
// ============================================================================

declare global {
  // deno-lint-ignore no-var
  var __pianoRollBridge__: Bridge | undefined
}

/**
 * Get or create the bridge singleton.
 * Stores in globalThis to survive notebook cell re-runs.
 */
function getBridge(): Bridge {
  if (!globalThis.__pianoRollBridge__) {
    console.log("[PianoRollBridge] Auto-initializing server (first use)...")
    initializeBridge()
  }
  return globalThis.__pianoRollBridge__!
}

/**
 * Manually initialize the piano roll bridge server.
 *
 * This is optional - the server will auto-initialize on first use.
 * Calling this explicitly gives you control over when the server starts
 * and provides visibility into the server URL.
 *
 * @returns Bridge info including the base URL
 */
export function initializePianoRollBridge(): { baseUrl: string, isNewServer: boolean } {
  if (globalThis.__pianoRollBridge__) {
    console.log("[PianoRollBridge] Server already running")
    return {
      baseUrl: globalThis.__pianoRollBridge__.baseUrl,
      isNewServer: false
    }
  }

  console.log("[PianoRollBridge] Initializing server...")
  initializeBridge()
  const bridge = globalThis.__pianoRollBridge__!

  console.log(`[PianoRollBridge] Server ready at ${bridge.baseUrl}`)
  return {
    baseUrl: bridge.baseUrl,
    isNewServer: true
  }
}

/**
 * Initialize the HTTP/WebSocket server singleton.
 */
function initializeBridge(): void {
  const sessions = new Map<string, SessionData>()

  // Resolve bundle path relative to this module
  const moduleDir = new URL(".", import.meta.url).pathname
  const bundlePath = `${moduleDir}copiedHelpers/piano-roll.js`

  // Create HTTP server on ephemeral port (non-blocking, returns immediately)
  // server.addr is available synchronously even with port: 0
  const server = Deno.serve({
    port: 0,
    onListen: ({ port, hostname }) => {
      console.log(`[PianoRollBridge] Server running at http://${hostname}:${port}`)
    }
  }, async (req) => {
    const url = new URL(req.url)

    // WebSocket upgrade
    if (req.headers.get("upgrade") === "websocket") {
      const sessionId = url.searchParams.get("id")
      if (!sessionId || !sessions.has(sessionId)) {
        return new Response("Session not found", { status: 404 })
      }
      return handleWebSocket(req, sessionId, sessions)
    }

    // HTTP routes
    if (url.pathname === "/editor") {
      return handleEditorRoute(url)
    }

    if (url.pathname === "/static/piano-roll.js") {
      return handleBundleRoute(bundlePath)
    }

    if (url.pathname === "/config") {
      return handleConfigRoute(url, sessions)
    }

    return new Response("Not found", { status: 404 })
  })

  // Get the actual port (ephemeral port is assigned by OS)
  const addr = server.addr as Deno.NetAddr
  const baseUrl = `http://127.0.0.1:${addr.port}`

  globalThis.__pianoRollBridge__ = {
    server,
    baseUrl,
    sessions,
    bundlePath
  }
}

// ============================================================================
// HTTP Route Handlers
// ============================================================================

/**
 * Serve the piano roll editor HTML page.
 */
function handleEditorRoute(url: URL): Response {
  const sessionId = url.searchParams.get("id")
  if (!sessionId) {
    return new Response("Missing session ID", { status: 400 })
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Piano Roll</title>
  <style>
    body {
      margin: 0;
      padding: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
    }
    #name-label {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #333;
      padding: 4px 8px;
      background: white;
      border-radius: 4px;
      display: inline-block;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    #name-label:empty {
      display: none;
    }
    #root {
      display: flex;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div id="name-label"></div>
  <div id="root"></div>
  <script type="module">
    // Fetch session config
    const sessionId = "${sessionId}"
    const response = await fetch(\`/config?id=\${sessionId}\`)
    const config = await response.json()

    // Show name label if provided
    if (config.name) {
      document.getElementById('name-label').textContent = config.name
    }

    // Load piano roll web component bundle
    // The bundle auto-registers the <piano-roll-component> custom element
    await import('/static/piano-roll.js')

    const wsUrl = \`ws://\${window.location.host}/ws?id=\${sessionId}\`

    // Wait for custom element to be defined, then create and mount it
    await customElements.whenDefined('piano-roll-component')

    const rootEl = document.getElementById('root')
    const pianoRoll = document.createElement('piano-roll-component')

    // Set attributes based on session config
    pianoRoll.setAttribute('ws-address', wsUrl)
    pianoRoll.setAttribute('interactive', config.interactive.toString())
    pianoRoll.setAttribute('show-control-panel', 'true')
    pianoRoll.setAttribute('width', '640')
    pianoRoll.setAttribute('height', '360')

    rootEl.appendChild(pianoRoll)

    console.log('[Piano Roll] Mounted successfully', { sessionId, wsUrl, config })
  </script>
</body>
</html>`

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  })
}

/**
 * Serve the piano roll bundle.
 */
async function handleBundleRoute(bundlePath: string): Promise<Response> {
  try {
    const file = await Deno.readFile(bundlePath)
    return new Response(file, {
      headers: { "Content-Type": "application/javascript; charset=utf-8" }
    })
  } catch (error) {
    console.error("[PianoRollBridge] Failed to read bundle:", error)
    return new Response("Bundle not found", { status: 404 })
  }
}

/**
 * Serve session configuration as JSON.
 */
function handleConfigRoute(url: URL, sessions: Map<string, SessionData>): Response {
  const sessionId = url.searchParams.get("id")
  if (!sessionId) {
    return new Response("Missing session ID", { status: 400 })
  }

  const session = sessions.get(sessionId)
  if (!session) {
    return new Response("Session not found", { status: 404 })
  }

  const config = {
    interactive: session.type === 'bound',
    name: session.type === 'bound' ? session.clipName : undefined
  }

  return new Response(JSON.stringify(config), {
    headers: { "Content-Type": "application/json" }
  })
}

// ============================================================================
// WebSocket Handler
// ============================================================================

/**
 * Handle WebSocket connection for a piano roll session.
 */
function handleWebSocket(
  req: Request,
  sessionId: string,
  sessions: Map<string, SessionData>
): Response {
  const { socket, response } = Deno.upgradeWebSocket(req)
  const session = sessions.get(sessionId)!

  const client = new PianoRollWebSocketClient(socket)
  session.client = client

  // Send initial state when connection is ready
  client.onConnectionReady = () => {
    let clip: AbletonClip | undefined

    if (session.type === 'readonly') {
      clip = session.clip
    } else if (session.type === 'bound') {
      clip = session.clipMap!.get(session.clipName!)
    }

    if (clip) {
      const notes = abletonToNoteData(clip.notes)
      client.setNotes(notes)
      client.fitZoomToNotes()
    }

    // Set interactivity
    client.setConfig({
      interactive: session.type === 'bound'
    })
  }

  // Handle note updates from piano roll (only for bound sessions)
  client.onNotesUpdate = (notesMap) => {
    if (session.type === 'bound') {
      const notes = Array.from(notesMap.values())
      const abletonNotes = noteDataToAbleton(notes)

      const clip = session.clipMap!.get(session.clipName!)
      if (clip) {
        // Update clip notes
        clip.notes = abletonNotes

        // Sync to ClipMap (which will notify other piano rolls)
        // Exclude this session to prevent echo
        session.clipMap!.set(session.clipName!, clip, {
          excludeSession: sessionId
        })
      }
    }
  }

  // Handle disconnect
  client.onDisconnect = () => {
    if (session.type === 'bound') {
      session.clipMap!.unbind(session.clipName!, sessionId)
    }
    sessions.delete(sessionId)
  }

  return response
}

// ============================================================================
// Public API Functions
// ============================================================================

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Display HTML iframe in notebook output.
 */
function displayIframe(sessionId: string): void {
  const bridge = getBridge()
  const url = `${bridge.baseUrl}/editor?id=${sessionId}`

  // Use Deno.jupyter.html tagged template
  // @ts-ignore - Deno.jupyter is only available in notebook context
  const view =Deno.jupyter.html`<iframe
    src="${url}"
    width="680"
    height="460"
    style="border: 1px solid #ccc; border-radius: 8px; background: white;"
  ></iframe>`
  Deno.jupyter.display(view)
}

/**
 * Display a read-only piano roll for a clip.
 * The piano roll will not be editable.
 *
 * @param clip - AbletonClip to display
 */
export function showMelody(clip: AbletonClip): void {
  const bridge = getBridge()
  const sessionId = generateSessionId()

  // Register read-only session
  bridge.sessions.set(sessionId, {
    type: 'readonly',
    clip
  })

  // Display iframe
  displayIframe(sessionId)
}

/**
 * Display a piano roll bound to a ClipMap entry.
 * The piano roll will be editable, and changes sync bidirectionally.
 *
 * Multiple piano rolls can bind to the same clip name - they will
 * all stay in sync with each other and the ClipMap.
 *
 * @param clipMap - ClipMap instance
 * @param name - Clip name in the map
 * @returns Handle to interact with the piano roll
 */
export function showBoundMelody(
  clipMap: ClipMap,
  name: string
): PianoRollHandle {
  const bridge = getBridge()
  const sessionId = generateSessionId()

  // Register bound session
  bridge.sessions.set(sessionId, {
    type: 'bound',
    clipMap,
    clipName: name
  })

  // Bind session to ClipMap
  clipMap.bind(name, sessionId)

  // Display iframe
  displayIframe(sessionId)

  // Return handle
  return {
    get latestClip(): AbletonClip | undefined {
      return clipMap.get(name)
    },

    disconnect(): void {
      clipMap.unbind(name, sessionId)
      const session = bridge.sessions.get(sessionId)
      session?.client?.disconnect()
      bridge.sessions.delete(sessionId)
    },

    setLivePlayhead(position: number): void {
      const session = bridge.sessions.get(sessionId)
      session?.client?.setLivePlayhead(position)
    },

    fitZoomToNotes(): void {
      const session = bridge.sessions.get(sessionId)
      session?.client?.fitZoomToNotes()
    }
  }
}

// ============================================================================
// Module Singleton Export
// ============================================================================

/**
 * Global ClipMap singleton for convenience.
 * You can use this or create your own ClipMap instances.
 */
export const clipMap = new ClipMap()
