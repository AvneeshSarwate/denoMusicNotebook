/**
 * Animation Editor Bridge - Deno Jupyter Notebook Integration
 *
 * Provides reactive animation editor visualization with WebSocket sync.
 * Uses HTTP+WebSocket bridge to sync state between kernel and browser.
 *
 * Usage:
 * ```typescript
 * import { trackMap, showAnimation, showBoundAnimation, initializeAnimationEditorBridge } from "./animationEditorBridge.ts"
 *
 * // Initialize (optional - auto-initializes on first use)
 * initializeAnimationEditorBridge()
 *
 * // Read-only display
 * showAnimation(myTracks)
 *
 * // Reactive binding
 * trackMap.set("myAnimation", myTracks)
 * const handle = showBoundAnimation(trackMap, "myAnimation")
 *
 * // Register callbacks
 * handle.setCallbacks({
 *   updateNumber: (trackName, value) => console.log(`${trackName}: ${value}`),
 *   updateEnum: (trackName, value) => console.log(`${trackName}: ${value}`),
 *   updateFunc: (trackName, funcName, ...args) => console.log(`${trackName}: ${funcName}(${args})`)
 * })
 *
 * // Scrub to time (fires callbacks)
 * handle.scrubToTime(2.5)
 * ```
 */

import {
  AnimationEditorWebSocketClient,
  type TrackData,
  type TrackInput,
  type TrackCallbacks,
  type AnimationEditorState
} from "../copiedHelpers/animationEditorWebSocketClient.ts"

// ============================================================================
// Type Definitions
// ============================================================================

interface SessionData {
  type: 'readonly' | 'bound'
  // For readonly sessions
  tracks?: TrackData[]
  trackOrder?: string[]
  // For bound sessions
  trackMap?: TrackMap
  animationName?: string
  // Both types
  client?: AnimationEditorWebSocketClient
}

interface Bridge {
  server: Deno.HttpServer
  baseUrl: string
  sessions: Map<string, SessionData>
  bundleUrl: URL
}

export interface AnimationEditorHandle {
  /** Always reads the latest tracks from the TrackMap */
  readonly latestTracks: TrackData[] | undefined
  /** Close this animation editor session */
  disconnect(): void
  /** Set the live playhead position (visual only) */
  setLivePlayhead(position: number): void
  /** Scrub to a specific time (fires callbacks) */
  scrubToTime(time: number): void
  /** Register callbacks for track evaluation */
  setCallbacks(callbacks: TrackCallbacks): void
  /** Get the WebSocket client for advanced usage */
  readonly client: AnimationEditorWebSocketClient | undefined
}

// ============================================================================
// Track ID Management
// ============================================================================

let trackIdCounter = 0
let elemIdCounter = 0

function generateTrackId(): string {
  return `track_${++trackIdCounter}_${Date.now()}`
}

function generateElemId(): string {
  return `elem_${++elemIdCounter}_${Date.now()}`
}

/**
 * Convert TrackInput array to TrackData array with generated IDs.
 */
export function trackInputsToData(inputs: TrackInput[]): { tracks: TrackData[]; trackOrder: string[] } {
  const tracks: TrackData[] = []
  const trackOrder: string[] = []

  for (const input of inputs) {
    const trackId = generateTrackId()
    trackOrder.push(trackId)

    const elementData = input.data.map(datum => {
      const elemId = generateElemId()
      if (input.fieldType === 'number') {
        const d = datum as { time: number; value: number }
        return { id: elemId, time: d.time, value: d.value }
      } else if (input.fieldType === 'enum') {
        const d = datum as { time: number; value: string }
        return { id: elemId, time: d.time, value: d.value }
      } else {
        const d = datum as { time: number; funcName: string; args?: readonly unknown[] }
        return { id: elemId, time: d.time, value: { funcName: d.funcName, args: d.args ?? [] } }
      }
    })

    tracks.push({
      id: trackId,
      name: input.name,
      fieldType: input.fieldType,
      elementData,
      low: input.low ?? 0,
      high: input.high ?? 1
    })
  }

  return { tracks, trackOrder }
}

// ============================================================================
// TrackMap - Reactive Map with Animation Editor Sync
// ============================================================================

/**
 * Reactive Map that automatically syncs changes to all bound animation editors.
 *
 * When you call `set(name, tracks)`, all animation editors bound to that name
 * will update automatically. Editor edits also update the map.
 */
export class TrackMap {
  private animations = new Map<string, { tracks: TrackData[]; trackOrder: string[] }>()
  private bindings = new Map<string, Set<string>>() // animationName -> Set<sessionId>

  /**
   * Get tracks by name.
   */
  get(name: string): TrackData[] | undefined {
    return this.animations.get(name)?.tracks
  }

  /**
   * Get tracks and order by name.
   */
  getFull(name: string): { tracks: TrackData[]; trackOrder: string[] } | undefined {
    return this.animations.get(name)
  }

  /**
   * Check if an animation exists.
   */
  has(name: string): boolean {
    return this.animations.has(name)
  }

  /**
   * Set tracks from TrackInput array (convenience method).
   */
  setFromInputs(name: string, inputs: TrackInput[], options?: { excludeSession?: string }): this {
    const { tracks, trackOrder } = trackInputsToData(inputs)
    return this.set(name, tracks, trackOrder, options)
  }

  /**
   * Set tracks and notify all bound animation editors.
   */
  set(
    name: string,
    tracks: TrackData[],
    trackOrder?: string[],
    options?: { excludeSession?: string }
  ): this {
    const order = trackOrder ?? tracks.map(t => t.id)
    this.animations.set(name, { tracks, trackOrder: order })

    // Notify all animation editors bound to this name
    const sessions = this.bindings.get(name)
    if (sessions) {
      for (const sessionId of sessions) {
        if (sessionId === options?.excludeSession) {
          continue // Skip the session that triggered this update (prevent echo)
        }

        const bridge = getBridge()
        const session = bridge.sessions.get(sessionId)
        if (session?.client?.connected) {
          session.client.setTracks(tracks, order)
        }
      }
    }

    return this
  }

  /**
   * Delete an animation and disconnect all bound editors.
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
    return this.animations.delete(name)
  }

  /**
   * Get all animation names.
   */
  keys(): IterableIterator<string> {
    return this.animations.keys()
  }

  /**
   * Get all track arrays.
   */
  *values(): IterableIterator<TrackData[]> {
    for (const anim of this.animations.values()) {
      yield anim.tracks
    }
  }

  /**
   * Get all [name, tracks] entries.
   */
  *entries(): IterableIterator<[string, TrackData[]]> {
    for (const [name, anim] of this.animations.entries()) {
      yield [name, anim.tracks]
    }
  }

  /**
   * Iterate over [name, tracks] entries.
   */
  [Symbol.iterator](): IterableIterator<[string, TrackData[]]> {
    return this.entries()
  }

  /**
   * Number of animations in the map.
   */
  get size(): number {
    return this.animations.size
  }

  /**
   * Clear all animations and disconnect all editors.
   */
  clear(): void {
    const bridge = getBridge()
    for (const sessions of this.bindings.values()) {
      for (const sessionId of sessions) {
        const session = bridge.sessions.get(sessionId)
        session?.client?.disconnect()
        bridge.sessions.delete(sessionId)
      }
    }
    this.bindings.clear()
    this.animations.clear()
  }

  /**
   * Internal: Bind a session to an animation name.
   */
  bind(animationName: string, sessionId: string): void {
    if (!this.bindings.has(animationName)) {
      this.bindings.set(animationName, new Set())
    }
    this.bindings.get(animationName)!.add(sessionId)
  }

  /**
   * Internal: Unbind a session from an animation name.
   */
  unbind(animationName: string, sessionId: string): void {
    const sessions = this.bindings.get(animationName)
    if (sessions) {
      sessions.delete(sessionId)
      if (sessions.size === 0) {
        this.bindings.delete(animationName)
      }
    }
  }
}

// ============================================================================
// Bridge Singleton Management
// ============================================================================

declare global {
  // deno-lint-ignore no-var
  var __animationEditorBridge__: Bridge | undefined
}

/**
 * Get or create the bridge singleton.
 */
function getBridge(): Bridge {
  if (!globalThis.__animationEditorBridge__) {
    console.log("[AnimationEditorBridge] Auto-initializing server (first use)...")
    initializeBridge()
  }
  return globalThis.__animationEditorBridge__!
}

/**
 * Manually initialize the animation editor bridge server.
 */
export function initializeAnimationEditorBridge(): { baseUrl: string; isNewServer: boolean } {
  if (globalThis.__animationEditorBridge__) {
    console.log("[AnimationEditorBridge] Server already running")
    return {
      baseUrl: globalThis.__animationEditorBridge__.baseUrl,
      isNewServer: false
    }
  }

  console.log("[AnimationEditorBridge] Initializing server...")
  initializeBridge()
  const bridge = globalThis.__animationEditorBridge__!

  console.log(`[AnimationEditorBridge] Server ready at ${bridge.baseUrl}`)
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
  const bundleUrl = new URL("../copiedHelpers/animation-editor.js", import.meta.url)

  const server = Deno.serve({
    port: 0,
    onListen: ({ port, hostname }) => {
      console.log(`[AnimationEditorBridge] Server running at http://${hostname}:${port}`)
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

    if (url.pathname === "/static/animation-editor.js") {
      return handleBundleRoute(bundleUrl)
    }

    if (url.pathname === "/config") {
      return handleConfigRoute(url, sessions)
    }

    return new Response("Not found", { status: 404 })
  })

  const addr = server.addr as Deno.NetAddr
  const baseUrl = `http://127.0.0.1:${addr.port}`

  globalThis.__animationEditorBridge__ = {
    server,
    baseUrl,
    sessions,
    bundleUrl
  }
}

// ============================================================================
// HTTP Route Handlers
// ============================================================================

function handleEditorRoute(url: URL): Response {
  const sessionId = url.searchParams.get("id")
  if (!sessionId) {
    return new Response("Missing session ID", { status: 400 })
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Animation Editor</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #121416;
    }
    #name-label {
      font-size: 14px;
      font-weight: 600;
      padding: 8px 16px;
      color: #c8c8c8;
      background: #0e1012;
      border-bottom: 1px solid #2a2d30;
    }
    #name-label:empty {
      display: none;
    }
    #root {
      width: 100%;
      height: calc(100% - 40px);
    }
    #root:only-child {
      height: 100%;
    }
    animation-editor-component {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="name-label"></div>
  <div id="root"></div>
  <script type="module">
    const sessionId = "${sessionId}"
    const response = await fetch(\`/config?id=\${sessionId}\`)
    const config = await response.json()

    if (config.name) {
      document.getElementById('name-label').textContent = config.name
    }

    await import('/static/animation-editor.js')

    const wsUrl = \`ws://\${window.location.host}/ws?id=\${sessionId}\`

    await customElements.whenDefined('animation-editor-component')

    const rootEl = document.getElementById('root')
    const editor = document.createElement('animation-editor-component')

    editor.setAttribute('ws-address', wsUrl)
    editor.setAttribute('interactive', config.interactive.toString())
    if (config.duration) {
      editor.setAttribute('duration', config.duration.toString())
    }

    rootEl.appendChild(editor)

    console.log('[Animation Editor] Mounted successfully', { sessionId, wsUrl, config })
  </script>
</body>
</html>`

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  })
}

async function handleBundleRoute(bundleUrl: URL): Promise<Response> {
  try {
    const file = await Deno.readFile(bundleUrl)
    return new Response(file, {
      headers: { "Content-Type": "application/javascript; charset=utf-8" }
    })
  } catch (error) {
    console.error("[AnimationEditorBridge] Failed to read bundle:", error)
    return new Response("Bundle not found", { status: 404 })
  }
}

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
    name: session.type === 'bound' ? session.animationName : undefined,
    duration: 16 // Default duration
  }

  return new Response(JSON.stringify(config), {
    headers: { "Content-Type": "application/json" }
  })
}

// ============================================================================
// WebSocket Handler
// ============================================================================

function handleWebSocket(
  req: Request,
  sessionId: string,
  sessions: Map<string, SessionData>
): Response {
  const { socket, response } = Deno.upgradeWebSocket(req)
  const session = sessions.get(sessionId)!

  const client = new AnimationEditorWebSocketClient(socket)
  session.client = client

  client.onConnectionReady = () => {
    let tracks: TrackData[] | undefined
    let trackOrder: string[] | undefined

    if (session.type === 'readonly') {
      tracks = session.tracks
      trackOrder = session.trackOrder
    } else if (session.type === 'bound') {
      const data = session.trackMap!.getFull(session.animationName!)
      tracks = data?.tracks
      trackOrder = data?.trackOrder
    }

    if (tracks && trackOrder) {
      client.setTracks(tracks, trackOrder)
    }

    client.setConfig({
      interactive: session.type === 'bound'
    })
  }

  client.onTracksUpdate = (tracks, trackOrder, source) => {
    if (source && source !== 'tracks') {
      return
    }
    if (session.type === 'bound') {
      session.trackMap!.set(session.animationName!, tracks, trackOrder, {
        excludeSession: sessionId
      })
    }
  }

  client.onDisconnect = () => {
    if (session.type === 'bound') {
      session.trackMap!.unbind(session.animationName!, sessionId)
    }
    sessions.delete(sessionId)
  }

  return response
}

// ============================================================================
// Public API Functions
// ============================================================================

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

function displayIframe(sessionId: string, width = 800, height = 500): void {
  const bridge = getBridge()
  const url = `${bridge.baseUrl}/editor?id=${sessionId}`

  // @ts-ignore - Deno.jupyter is only available in notebook context
  const view = Deno.jupyter.html`<iframe
    src="${url}"
    width="${width}"
    height="${height}"
    style="border: 1px solid #2a2d30; border-radius: 8px; background: #121416;"
  ></iframe>`
  Deno.jupyter.display(view)
}

/**
 * Display a read-only animation editor.
 */
export function showAnimation(tracks: TrackData[], trackOrder?: string[]): void {
  const bridge = getBridge()
  const sessionId = generateSessionId()
  const order = trackOrder ?? tracks.map(t => t.id)

  bridge.sessions.set(sessionId, {
    type: 'readonly',
    tracks,
    trackOrder: order
  })

  displayIframe(sessionId)
}

/**
 * Display a read-only animation editor from TrackInput array.
 */
export function showAnimationFromInputs(inputs: TrackInput[]): void {
  const { tracks, trackOrder } = trackInputsToData(inputs)
  showAnimation(tracks, trackOrder)
}

/**
 * Display an animation editor bound to a TrackMap entry.
 */
export function showBoundAnimation(
  trackMap: TrackMap,
  name: string
): AnimationEditorHandle {
  const bridge = getBridge()
  const sessionId = generateSessionId()

  bridge.sessions.set(sessionId, {
    type: 'bound',
    trackMap,
    animationName: name
  })

  trackMap.bind(name, sessionId)
  displayIframe(sessionId)

  return {
    get latestTracks(): TrackData[] | undefined {
      return trackMap.get(name)
    },

    get client(): AnimationEditorWebSocketClient | undefined {
      return bridge.sessions.get(sessionId)?.client
    },

    disconnect(): void {
      trackMap.unbind(name, sessionId)
      const session = bridge.sessions.get(sessionId)
      session?.client?.disconnect()
      bridge.sessions.delete(sessionId)
    },

    setLivePlayhead(position: number): void {
      const session = bridge.sessions.get(sessionId)
      session?.client?.setLivePlayhead(position)
    },

    scrubToTime(time: number): void {
      const session = bridge.sessions.get(sessionId)
      session?.client?.scrubToTime(time)
    },

    setCallbacks(callbacks: TrackCallbacks): void {
      const session = bridge.sessions.get(sessionId)
      session?.client?.setTrackCallbacks(callbacks)
    }
  }
}

// ============================================================================
// Module Singleton Export
// ============================================================================

/**
 * Global TrackMap singleton for convenience.
 */
export const trackMap = new TrackMap()

// Re-export types for convenience
export type {
  TrackData,
  TrackInput,
  TrackCallbacks,
  AnimationEditorState,
  TrackType,
  NumberElement,
  EnumElement,
  FuncElementData,
  FuncElement
} from "../copiedHelpers/animationEditorWebSocketClient.ts"
