# MIDI bridge (midir + Deno)

This module exposes a Deno API backed by a native Rust library (`midir`) for MIDI I/O with coalesced continuous controls and preserved note edges.

## Build the native library

From the repo root:

```bash
./scripts/build_midi_bridge.sh
```

The built library is copied to `./native/libmidi_bridge.dylib` (macOS), `.so` (Linux), or `.dll` (Windows).

## Quick start

```ts
import { MidiAccess } from "./midi/mod.ts";

const midi = MidiAccess.open({ libPath: "./native/libmidi_bridge.dylib" });

const inputs = midi.listInputs();
const outputs = midi.listOutputs();

const input = midi.openInput(inputs[0].id, { rateHz: 250 });
const output = midi.openOutput(outputs[0].id);

const off = input.onNote((evt) => {
  console.log(evt);
});

output.noteOn(0, 60, 100);
output.noteOff(0, 60, 64);

off();
input.close();
output.close();
midi.close();
```

Run Deno with FFI permissions:

```bash
deno run --allow-ffi --allow-read your_script.ts
```

## API reference

### MidiAccess

```ts
const midi = MidiAccess.open({ libPath });
```

- `MidiAccess.open(options: { libPath: string }): MidiAccess`
- `listInputs(): PortInfo[]`
- `listOutputs(): PortInfo[]`
- `openInput(portId: string, options?: MidiInputOptions): MidiInput`
- `openOutput(portId: string): MidiOutput`
- `close(): void`

`PortInfo`:

```ts
type PortInfo = { id: string; name: string };
```

### MidiInput

Open input with:

```ts
const input = midi.openInput(portId, { rateHz: 250, flags: 0, keepAlive: true });
```

`MidiInputOptions`:

```ts
type MidiInputOptions = {
  rateHz?: number;   // dispatch tick rate (default 250)
  flags?: number;    // reserved for future options
  keepAlive?: boolean; // default true; set false to allow process exit
};
```

Event subscriptions (all return `unsubscribe()`):

```ts
input.onCC((evt) => {});
input.onPitchBend((evt) => {});
input.onChannelPressure((evt) => {});
input.onPolyPressure((evt) => {});
input.onProgramChange((evt) => {});
input.onNoteOn((evt) => {});
input.onNoteOff((evt) => {});
input.onNote((evt) => {});
input.onTick((tick) => {});
```

Event payloads:

```ts
type CCEvent = { channel: number; ctrlNum: number; ctrlVal: number; tsUs: number };
type PitchBendEvent = { channel: number; bend: number; tsUs: number }; // -8192..8191
type ChannelPressureEvent = { channel: number; pressure: number; tsUs: number };
type PolyPressureEvent = { channel: number; noteNum: number; pressure: number; tsUs: number };
type ProgramChangeEvent = { channel: number; program: number; tsUs: number };

type NoteOnEvent = { channel: number; noteNum: number; velocity: number; tsUs: number };
type NoteOffEvent = { channel: number; noteNum: number; velocity: number; tsUs: number };
type NoteEvent = { channel: number; noteNum: number; on: boolean; velocity: number; tsUs: number };
```

`onTick` gives a coalesced batch per dispatch tick:

```ts
type TickPayload = {
  tsUs: number;
  droppedRaw: number;
  droppedNote: number;
  ccChanges: CCEvent[];
  pbChanges: PitchBendEvent[];
  chPressureChanges: ChannelPressureEvent[];
  polyPressureChanges: PolyPressureEvent[];
  programChanges: ProgramChangeEvent[];
  noteEvents: NoteEvent[];
};
```

Other methods:

```ts
input.asMPE(config) // -> MPEInput
input.close();
```

### MidiOutput

```ts
const output = midi.openOutput(portId);

output.send(Uint8Array.of(0x90, 60, 100));
output.cc(0, 74, 100);
output.pitchBend(0, 1234);
output.noteOn(0, 60, 100);
output.noteOff(0, 60, 64);
output.channelPressure(0, 80);
output.programChange(0, 10);

output.close();
```

### MPE helper

```ts
const mpe = input.asMPE({
  zone: "lower",             // "lower" or "upper"
  masterChannel: 0,          // default 0 for lower, 15 for upper
  memberChannels: [1, 15],   // inclusive range
  timbreCC: 74,              // default 74
});

mpe.onNoteStart((evt) => {});
mpe.onNoteUpdate((evt) => {});
mpe.onNoteEnd((evt) => {});

mpe.close();
```

MPE events:

```ts
type MPENoteStart = {
  channel: number;
  noteNum: number;
  velocity: number;
  pressure: number;
  timbre: number;
  bend: number;
};

type MPENoteUpdate = {
  channel: number;
  noteNum: number;
  pressure: number;
  timbre: number;
  bend: number;
};

type MPENoteEnd = { channel: number; noteNum: number; velocity: number };
```

## Coalescing semantics

- CC / pitch bend / pressure / program change are coalesced per channel/key, “latest wins” per dispatch tick.
- Note on/off edges are preserved and not coalesced.
- `tsUs` in events is the timestamp from `midir` for the last raw MIDI message that set the value.

## Tests

Test scripts live under `midi/tests/`:

- `midi/tests/01_list_ports.ts`
- `midi/tests/02_send_receive_note.ts`
- `midi/tests/03_coalescing_cc.ts`
- `midi/tests/04_mpe_basic.ts`

Run them from `denoMusicNotebook/`:

```bash
deno run --allow-ffi --allow-read midi/tests/01_list_ports.ts
```
