export type RoomId = 0 | 1 | 2;
export type Mood = "neutral" | "happy" | "worried";
export type FaceState = "idle" | "listen" | "talk" | "cheer";
export type InteractionId =
  | "inspect-gear"
  | "turn-crank"
  | "set-minute"
  | "set-hour"
  | "take-mainspring"
  | "unlock-cage";

export interface RoomDefinition {
  id: RoomId;
  name: string;
  nodes: readonly string[];
  adjacency: Readonly<Record<string, readonly string[]>>;
  positions: Readonly<Record<string, readonly [number, number, number]>>;
}

export const ROOMS: readonly RoomDefinition[] = [
  {
    id: 0,
    name: "Workshop",
    nodes: ["entry", "workbench", "clock-door"],
    adjacency: {
      entry: ["workbench"],
      workbench: ["entry", "clock-door"],
      "clock-door": ["workbench"],
    },
    positions: {
      entry: [-6, 0.8, 1],
      workbench: [-2.4, 0.8, 0],
      "clock-door": [1.6, 0.8, -1],
    },
  },
  {
    id: 1,
    name: "Clock Hall",
    nodes: ["landing", "switches", "conservatory-door"],
    adjacency: {
      landing: ["switches"],
      switches: ["landing", "conservatory-door"],
      "conservatory-door": ["switches"],
    },
    positions: {
      landing: [-5.4, 0.8, 1],
      switches: [-1.2, 0.8, 0],
      "conservatory-door": [2.4, 0.8, -1],
    },
  },
  {
    id: 2,
    name: "Conservatory",
    nodes: ["arrival", "cage"],
    adjacency: {
      arrival: ["cage"],
      cage: ["arrival"],
    },
    positions: {
      arrival: [-5.2, 0.8, 1],
      cage: [-0.4, 0.8, 0],
    },
  },
];

export const INTERACTIONS: readonly {
  id: InteractionId;
  label: string;
  node: string;
  requires: readonly InteractionId[];
}[] = [
  {id: "inspect-gear", label: "Inspect gear", node: "workbench", requires: []},
  {id: "turn-crank", label: "Turn crank", node: "workbench", requires: ["inspect-gear"]},
  {id: "set-minute", label: "Set minute hand", node: "switches", requires: []},
  {id: "set-hour", label: "Set hour hand", node: "switches", requires: ["set-minute"]},
  {id: "take-mainspring", label: "Take mainspring", node: "switches", requires: ["set-hour"]},
  {id: "unlock-cage", label: "Unlock rescue cage", node: "cage", requires: []},
];

export type DialogueId = "intro" | "gear" | "workshop-door" | "clocks" | "conservatory" | "rescue";

const DIALOGUE: Readonly<Record<DialogueId, {speaker: string; text: string}>> = {
  intro: {speaker: "Tock", text: "The workshop door is barred. I need a gear clue and enough leverage to open it."},
  gear: {speaker: "Tock", text: "The gear teeth form a crank pattern. The brass key was hidden behind the plate."},
  "workshop-door": {speaker: "Tock", text: "The crank caught. The clock hall is open, but the hands must agree."},
  clocks: {speaker: "Tock", text: "Minute and hour now align. I can reach the conservatory."},
  conservatory: {speaker: "Tock", text: "Pip is trapped behind a spring lock. The brass key and mainspring should release it."},
  rescue: {speaker: "Pip", text: "You found me! The workshop is running again. Thank you, Tock."},
};

export interface QuestFlags {
  workshopDoorOpen: boolean;
  minuteSet: boolean;
  hourSet: boolean;
  clockDoorOpen: boolean;
  mainspringTaken: boolean;
  cageUnlocked: boolean;
  companionFreed: boolean;
}

export interface QuestSnapshot {
  room: RoomId;
  node: string;
  interactions: InteractionId[];
  inventory: string[];
  flags: QuestFlags;
  dialogue: DialogueId;
  playMs: number;
}

export const SAVE_FORMAT = "ksu.game.save";
export const SAVE_APP_ID = "clockwork-quest";
export const CONTENT_VERSION = "1";
const MAX_PLAY_MS = 30 * 24 * 60 * 60 * 1000;
const ITEMS = new Set(["brass-key", "mainspring"]);
const DIALOGUE_IDS = new Set<DialogueId>(Object.keys(DIALOGUE) as DialogueId[]);
const INTERACTION_IDS = new Set<InteractionId>(INTERACTIONS.map(item => item.id));

export class SaveError extends Error {
  constructor(reason: string) {
    super(`clockwork-quest save rejected: ${reason}`);
    this.name = "SaveError";
  }
}

export class ClockworkQuestSession {
  room: RoomId = 0;
  node = "entry";
  interactions = new Set<InteractionId>();
  inventory = new Set<string>();
  flags: QuestFlags = {
    workshopDoorOpen: false,
    minuteSet: false,
    hourSet: false,
    clockDoorOpen: false,
    mainspringTaken: false,
    cageUnlocked: false,
    companionFreed: false,
  };
  dialogue: DialogueId = "intro";
  playMs = 0;
  paused = true;
  revision = 0;

  constructor(snapshot?: QuestSnapshot) {
    if (snapshot) this.applySnapshot(snapshot);
  }

  get roomDefinition(): RoomDefinition {
    return ROOMS[this.room];
  }

  get dialogueLine(): {speaker: string; text: string} {
    return DIALOGUE[this.dialogue];
  }

  get face() {
    const speaking = this.dialogue !== "intro";
    const mood: Mood = this.flags.companionFreed ? "happy" :
      this.flags.clockDoorOpen || this.flags.workshopDoorOpen ? "neutral" : "worried";
    const state: FaceState = this.flags.companionFreed ? "cheer" :
      this.dialogue === "conservatory" ? "listen" : speaking ? "talk" : "idle";
    return {mood, speaking, attentionX: this.flags.companionFreed ? 0 : 1, state};
  }

  resume(): void {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }

  advance(deltaMs: number): void {
    if (this.paused) return;
    this.playMs = Math.min(MAX_PLAY_MS, this.playMs + Math.floor(Math.min(Math.max(0, deltaMs), 250)));
  }

  availableDestinations(): string[] {
    const room = this.roomDefinition;
    const destinations = [...(room.adjacency[this.node] ?? [])];
    if (this.node === "clock-door" && this.flags.workshopDoorOpen) destinations.push("go:clock-hall");
    if (this.node === "conservatory-door" && this.flags.clockDoorOpen) destinations.push("go:conservatory");
    return destinations;
  }

  moveTo(destination: string): {ok: boolean; message: string} {
    if (this.paused) return {ok: false, message: "Adventure paused. Press Resume first."};
    if (destination === "go:clock-hall") {
      if (this.node !== "clock-door" || !this.flags.workshopDoorOpen) {
        return {ok: false, message: "The workshop door is still barred."};
      }
      this.room = 1;
      this.node = "landing";
      this.dialogue = "conservatory";
      this.revision++;
      return {ok: true, message: "Entered the Clock Hall. The path to the conservatory is sealed."};
    }
    if (destination === "go:conservatory") {
      if (this.node !== "conservatory-door" || !this.flags.clockDoorOpen) {
        return {ok: false, message: "The clock hands do not yet open the wall."};
      }
      this.room = 2;
      this.node = "arrival";
      this.dialogue = "conservatory";
      this.revision++;
      return {ok: true, message: "Entered the Conservatory. Pip is inside the rescue cage."};
    }
    if (!this.availableDestinations().includes(destination)) {
      return {ok: false, message: "That destination is outside this room's walkable path."};
    }
    this.node = destination;
    this.revision++;
    return {ok: true, message: `Moved to ${destination.replaceAll("-", " ")}.`};
  }

  interactionAvailable(id: InteractionId): boolean {
    const interaction = INTERACTIONS.find(item => item.id === id);
    return !!interaction && interaction.node === this.node && !this.interactions.has(id) &&
      interaction.requires.every(required => this.interactions.has(required));
  }

  interact(id: InteractionId): {ok: boolean; message: string} {
    if (this.paused) return {ok: false, message: "Adventure paused. Press Resume first."};
    const interaction = INTERACTIONS.find(item => item.id === id);
    if (!interaction) return {ok: false, message: "That interaction does not exist."};
    if (interaction.node !== this.node) return {ok: false, message: `Move to ${interaction.node.replaceAll("-", " ")} to interact.`};
    if (this.interactions.has(id)) return {ok: false, message: "That mechanism is already complete."};
    if (!interaction.requires.every(required => this.interactions.has(required))) {
      return {ok: false, message: "The mechanism is locked by an earlier step."};
    }
    if (id === "unlock-cage" && (!this.inventory.has("brass-key") || !this.inventory.has("mainspring"))) {
      return {ok: false, message: "The rescue cage needs both the brass key and mainspring."};
    }
    this.interactions.add(id);
    if (id === "inspect-gear") {
      this.inventory.add("brass-key");
      this.dialogue = "gear";
    } else if (id === "turn-crank") {
      this.flags.workshopDoorOpen = true;
      this.dialogue = "workshop-door";
    } else if (id === "set-minute") {
      this.flags.minuteSet = true;
      this.dialogue = "clocks";
    } else if (id === "set-hour") {
      this.flags.hourSet = true;
      this.flags.clockDoorOpen = true;
      this.dialogue = "clocks";
    } else if (id === "take-mainspring") {
      this.flags.mainspringTaken = true;
      this.inventory.add("mainspring");
      this.dialogue = "clocks";
    } else {
      this.flags.cageUnlocked = true;
      this.flags.companionFreed = true;
      this.dialogue = "rescue";
    }
    this.revision++;
    return {ok: true, message: this.dialogueLine.text};
  }

  get complete(): boolean {
    return this.flags.companionFreed;
  }

  snapshot(): QuestSnapshot {
    return {
      room: this.room,
      node: this.node,
      interactions: [...this.interactions],
      inventory: [...this.inventory],
      flags: {...this.flags},
      dialogue: this.dialogue,
      playMs: this.playMs,
    };
  }

  applySnapshot(snapshot: QuestSnapshot): void {
    validateSnapshot(snapshot);
    this.room = snapshot.room;
    this.node = snapshot.node;
    this.interactions = new Set(snapshot.interactions);
    this.inventory = new Set(snapshot.inventory);
    this.flags = {...snapshot.flags};
    this.dialogue = snapshot.dialogue;
    this.playMs = snapshot.playMs;
    this.paused = true;
    this.revision++;
  }
}

export function validateSnapshot(snapshot: QuestSnapshot): void {
  if (!snapshot || typeof snapshot !== "object") throw new SaveError("missing payload");
  if (![0, 1, 2].includes(snapshot.room)) throw new SaveError("invalid room");
  const room = ROOMS[snapshot.room];
  if (!room || !room.nodes.includes(snapshot.node)) throw new SaveError("node is not in the selected room");
  if (!Array.isArray(snapshot.interactions) || new Set(snapshot.interactions).size !== snapshot.interactions.length ||
      snapshot.interactions.some(id => !INTERACTION_IDS.has(id))) throw new SaveError("invalid interactions");
  const interactions = new Set(snapshot.interactions);
  if (interactions.has("turn-crank") && !interactions.has("inspect-gear")) throw new SaveError("crank precedes gear inspection");
  if (interactions.has("set-hour") && !interactions.has("set-minute")) throw new SaveError("hour precedes minute");
  if (interactions.has("take-mainspring") && !interactions.has("set-hour")) throw new SaveError("mainspring precedes clock alignment");
  if (!Array.isArray(snapshot.inventory) || new Set(snapshot.inventory).size !== snapshot.inventory.length ||
      snapshot.inventory.some(item => typeof item !== "string" || !ITEMS.has(item))) throw new SaveError("invalid inventory");
  if (snapshot.inventory.includes("brass-key") && !interactions.has("inspect-gear")) throw new SaveError("brass key has no source");
  if (snapshot.inventory.includes("mainspring") && !interactions.has("take-mainspring")) throw new SaveError("mainspring has no source");
  if (!snapshot.flags || typeof snapshot.flags !== "object" || Object.values(snapshot.flags).some(value => typeof value !== "boolean")) {
    throw new SaveError("invalid flags");
  }
  if (snapshot.flags.workshopDoorOpen !== interactions.has("turn-crank")) throw new SaveError("workshop door mismatch");
  if (snapshot.flags.minuteSet !== interactions.has("set-minute")) throw new SaveError("minute switch mismatch");
  if (snapshot.flags.hourSet !== interactions.has("set-hour")) throw new SaveError("hour switch mismatch");
  if (snapshot.flags.clockDoorOpen !== interactions.has("set-hour")) throw new SaveError("clock door mismatch");
  if (snapshot.flags.mainspringTaken !== interactions.has("take-mainspring")) throw new SaveError("mainspring flag mismatch");
  if (snapshot.flags.cageUnlocked !== interactions.has("unlock-cage")) throw new SaveError("cage flag mismatch");
  if (snapshot.flags.companionFreed !== snapshot.flags.cageUnlocked) throw new SaveError("companion state mismatch");
  if (!DIALOGUE_IDS.has(snapshot.dialogue)) throw new SaveError("invalid dialogue");
  if (!Number.isSafeInteger(snapshot.playMs) || snapshot.playMs < 0 || snapshot.playMs > MAX_PLAY_MS) throw new SaveError("invalid timer");
}

export function encodeSave(session: ClockworkQuestSession): string {
  return JSON.stringify({
    format: SAVE_FORMAT,
    schemaVersion: 1,
    appId: SAVE_APP_ID,
    kind: "logical-snapshot",
    gameBuild: "clockwork-quest-preview/1",
    contentVersion: CONTENT_VERSION,
    payload: session.snapshot(),
  });
}

export function decodeSave(text: string, maxBytes = 2 * 1024 * 1024): {payload: QuestSnapshot} {
  const size = new TextEncoder().encode(text).byteLength;
  if (size > maxBytes) throw new SaveError("document exceeds the size limit");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new SaveError("document is not valid JSON"); }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.format !== SAVE_FORMAT || envelope.schemaVersion !== 1 || envelope.appId !== SAVE_APP_ID ||
      envelope.kind !== "logical-snapshot" || envelope.contentVersion !== CONTENT_VERSION ||
      !envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    throw new SaveError("wrong envelope");
  }
  validateSnapshot(envelope.payload as QuestSnapshot);
  return {payload: envelope.payload as QuestSnapshot};
}
