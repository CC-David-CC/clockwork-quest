import {ArcRotateCamera} from "@babylonjs/core/Cameras/arcRotateCamera.js";
import {Engine} from "@babylonjs/core/Engines/engine.js";
import {PointerEventTypes} from "@babylonjs/core/Events/pointerEvents.js";
import {HemisphericLight} from "@babylonjs/core/Lights/hemisphericLight.js";
import {StandardMaterial} from "@babylonjs/core/Materials/standardMaterial.js";
import {Color3, Color4} from "@babylonjs/core/Maths/math.color.js";
import {Vector3} from "@babylonjs/core/Maths/math.vector.js";
import {MeshBuilder} from "@babylonjs/core/Meshes/meshBuilder.js";
import type {Mesh} from "@babylonjs/core/Meshes/mesh.js";
import {TransformNode} from "@babylonjs/core/Meshes/transformNode.js";
import {Scene} from "@babylonjs/core/scene.js";
import {SynthAudio} from "../audio/synth.js";
import {XRController, supportedXRMode, type XRMode, type XRHelperLike} from "./xr-controls.js";
import {
  ClockworkQuestSession,
  INTERACTIONS,
  ROOMS,
  decodeSave,
  encodeSave,
  type InteractionId,
  type QuestSnapshot,
} from "../model/quest.js";

interface FileContext {
  owner: string;
  valid(): boolean;
  path(value: string): string;
  name(value: string): string;
  files: {
    read(path: string): Promise<{data: Uint8Array; version: string; status?: string}>;
    write(path: string, data: Uint8Array, expected?: string | null): Promise<{version: string; status?: string}>;
    stat?(path: string): Promise<{version: string; status?: string}>;
    subscribe?(callback: () => void): () => void;
  };
}

export interface Host {
  signal?: AbortSignal;
  w?: {
    title?: string;
    ownerSub?: string;
    launchContext?: {version: 1; storage: "mirror"; path: string; owner: string};
    clockworkQuest?: {dirty: boolean};
  };
  ui: {
    make(tag: string, className?: string, text?: string): HTMLElement;
    textButton(label: string, action: () => void): HTMLButtonElement;
    appInput(label: string, value?: string): HTMLInputElement;
    confirm?(message: string, options?: {
      title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; signal?: AbortSignal;
    }): Promise<boolean>;
  };
  storage: {
    signedInSubject(): string;
    mirrorFileContext(): Promise<FileContext>;
    pickFile(options: {extensions: string[]; signal?: AbortSignal}): Promise<string | null>;
    pickFolder(options: {signal?: AbortSignal}): Promise<string | null>;
  };
}

export interface ViewHandle {
  element: HTMLElement;
  dispose(): void;
}

const ROOM_TITLES = ["Workshop", "Clock Hall", "Conservatory"];
const NODE_LABELS: Record<string, string> = {
  entry: "Entrance",
  workbench: "Workbench",
  "clock-door": "Clock door",
  landing: "Landing",
  switches: "Hand controls",
  "conservatory-door": "Conservatory door",
  arrival: "Garden path",
  cage: "Rescue cage",
  "go:clock-hall": "Enter Clock Hall",
  "go:conservatory": "Enter Conservatory",
};

function material(scene: Scene, name: string, color: string, emissive = 0): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.FromHexString(color);
  result.emissiveColor = Color3.FromHexString(color).scale(emissive);
  result.specularColor = new Color3(0.18, 0.18, 0.18);
  return result;
}

export async function startView(host: Host, signal: AbortSignal): Promise<ViewHandle> {
  const {make, textButton, appInput} = host.ui;
  const owner = host.w?.launchContext?.owner || host.storage.signedInSubject();
  const windowState = host.w?.clockworkQuest ?? {dirty: false};
  if (host.w) {
    host.w.clockworkQuest = windowState;
    host.w.ownerSub = owner;
  }
  let session = new ClockworkQuestSession();
  let disposed = false;
  let busy = false;
  let savedPath: string | null = null;
  let savedVersion: string | null = null;
  let revision = 0;
  let engine: Engine | null = null;
  let scene: Scene | null = null;
  let camera: ArcRotateCamera | null = null;
  let player: TransformNode | null = null;
  let roomRoots: TransformNode[] = [];
  let unwatch = () => {};
  let watchSerial = 0;
  let watchCheck = 0;
  let last = performance.now();
  let xrMode: XRMode | null = null;
  let xrBusy = false;
  const xrController = new XRController(() => {
    if (!valid()) return;
    xrButton.textContent = "Enter XR";
    xrButton.disabled = !xrMode;
    announce("XR ended. Adventure remains paused.");
  });
  const audio = new SynthAudio();
  const listening = new AbortController();
  const viewSignal = signal;

  const element = make("section", "clockwork-quest-view");
  const layout = make("div", "clockwork-quest-layout");
  const header = make("header", "clockwork-quest-header");
  const heading = make("div", "clockwork-quest-heading");
  heading.append(
    make("h2", "", "Clockwork Quest"),
    make("p", "", "Three rooms · six mechanisms · one rescued friend"),
  );
  const toolbar = make("div", "clockwork-quest-toolbar");
  const runButton = textButton("Run", () => togglePause());
  const restartButton = textButton("Restart", () => void restart());
  const openButton = textButton("Open from My files", () => void open());
  const saveButton = textButton("Save to My files", () => void save());
  const xrButton = textButton("Enter XR", () => void enterXR());
  toolbar.append(runButton, restartButton, openButton, saveButton, xrButton);
  header.append(heading, toolbar);

  const stage = make("div", "clockwork-quest-stage");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "Clockwork Quest 3D diorama");
  canvas.tabIndex = 0;
  stage.append(canvas);

  const side = make("aside", "clockwork-quest-side");
  const roomTitle = make("div", "clockwork-quest-room-title");
  const status = make("div", "clockwork-quest-status", "Press Run to begin the adventure.");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const warning = make("p", "clockwork-quest-warning");
  warning.hidden = true;
  warning.setAttribute("role", "status");
  const dialogue = make("div", "clockwork-quest-dialogue");
  const speaker = make("strong", "");
  const dialogueText = make("p", "");
  dialogue.append(speaker, dialogueText);
  const face = make("div", "clockwork-quest-face");
  const inventory = make("div", "clockwork-quest-inventory");
  const destinations = make("div", "clockwork-quest-destinations");
  const interactionSelect = document.createElement("select");
  interactionSelect.setAttribute("aria-label", "Interaction");
  for (const item of INTERACTIONS) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    interactionSelect.append(option);
  }
  const interactButton = textButton("Interact", () => interact(interactionSelect.value as InteractionId));
  const moveControls = make("div", "clockwork-quest-move");
  side.append(roomTitle, inventory, destinations, dialogue, face, warning, moveControls, interactionSelect, interactButton, status);

  const settings = document.createElement("details");
  settings.className = "clockwork-quest-details";
  const soundLabel = make("label", "", "Sound ");
  const sound = document.createElement("input");
  sound.type = "checkbox";
  sound.setAttribute("aria-label", "Sound effects");
  soundLabel.prepend(sound);
  const volume = document.createElement("input");
  volume.type = "range";
  volume.min = "0";
  volume.max = "100";
  volume.value = "25";
  volume.disabled = true;
  volume.setAttribute("aria-label", "Sound volume");
  const motionLabel = make("label", "", "Reduced motion ");
  const motion = document.createElement("input");
  motion.type = "checkbox";
  motion.setAttribute("aria-label", "Reduced motion");
  motionLabel.prepend(motion);
  const contrastLabel = make("label", "", "High contrast ");
  const contrast = document.createElement("input");
  contrast.type = "checkbox";
  contrast.setAttribute("aria-label", "High contrast");
  contrastLabel.prepend(contrast);
  settings.append(make("summary", "", "Settings"), soundLabel, volume, motionLabel, contrastLabel);

  const help = document.createElement("details");
  help.className = "clockwork-quest-details";
  help.append(
    make("summary", "", "How to play"),
    make("p", "", "Move between marked destinations, choose an interaction, and press Interact. Inspect the workbench gear, use the crank, align both clock hands, take the mainspring, then free Pip in the conservatory. WASD moves between nearby destinations; E interacts."),
  );

  const saveDetails = document.createElement("details");
  saveDetails.className = "clockwork-quest-details clockwork-quest-save";
  const saveFields = make("div", "clockwork-quest-save-fields");
  const path = appInput("Clockwork Quest save path", host.w?.launchContext?.path || "/Clockwork Quest.game.json");
  const folder = textButton("Choose folder", () => void chooseFolder());
  saveFields.append(path, folder);
  saveDetails.append(make("summary", "", "Save location"), saveFields);

  const technologyNote = make(
    "p",
    "clockwork-quest-note",
    "Procedural character bodies and face panels are development fallbacks. Final glTF character animation and quest-faces.riv remain pending.",
  );
  side.append(settings, help, saveDetails, technologyNote);
  layout.append(stage, side);
  element.append(header, layout);

  const valid = () =>
    !disposed && !viewSignal.aborted && !listening.signal.aborted && element.isConnected &&
    owner === host.storage.signedInSubject();
  const announce = (message: string) => {
    if (valid()) status.textContent = message;
  };
  const setDirty = (value: boolean) => {
    windowState.dirty = value;
  };
  const setBusy = (value: boolean) => {
    busy = value;
    runButton.disabled = value;
    restartButton.disabled = value;
    openButton.disabled = value;
    saveButton.disabled = value;
    interactButton.disabled = value;
  };

  function buildRoom(id: number): TransformNode {
    const root = new TransformNode(`room-${id}`, scene!);
    root.position.x = id * 16;
    const floorMaterial = material(scene!, `floor-${id}`, id === 2 ? "#7c9b68" : "#6c5b47", 0.06);
    const floor = MeshBuilder.CreateGround(`floor-${id}`, {width: 12, height: 8}, scene!);
    floor.material = floorMaterial;
    floor.parent = root;
    const back = MeshBuilder.CreateBox(`back-${id}`, {width: 12, height: 5, depth: 0.2}, scene!);
    back.position.set(0, 2.4, 4);
    back.material = material(scene!, `wall-${id}`, id === 2 ? "#abc69b" : "#aa9277", 0.02);
    back.parent = root;
    for (const [index, node] of ROOMS[id].nodes.entries()) {
      const position = ROOMS[id].positions[node];
      const pad = MeshBuilder.CreateCylinder(`pad-${id}-${node}`, {height: 0.16, diameter: 1.2, tessellation: 16}, scene!);
      pad.position.set(position[0], 0.08, position[2]);
      pad.material = material(scene!, `pad-mat-${id}-${node}`, "#d5c18c", 0.12);
      pad.metadata = {destination: node};
      pad.parent = root;
      const marker = MeshBuilder.CreateBox(`marker-${id}-${node}`, {width: 0.45, height: 0.08, depth: 0.45}, scene!);
      marker.position.set(position[0], 0.18, position[2]);
      marker.material = material(scene!, `marker-mat-${id}-${node}`, "#f0d879", 0.35);
      marker.parent = root;
      if (index === 0) marker.rotation.y = 0.2;
    }
    if (id === 0) {
      const gear = MeshBuilder.CreateTorus("workbench-gear", {diameter: 1.6, thickness: 0.28, tessellation: 20}, scene!);
      gear.position.set(-2.4, 1.6, 2.5);
      gear.material = material(scene!, "brass", "#c99b45", 0.18);
      gear.parent = root;
      const bench = MeshBuilder.CreateBox("workbench", {width: 2.6, height: 0.65, depth: 1.1}, scene!);
      bench.position.set(-2.4, 0.6, 2.5);
      bench.material = material(scene!, "wood", "#755539");
      bench.parent = root;
    } else if (id === 1) {
      const clock = MeshBuilder.CreateCylinder("clock-face", {height: 0.18, diameter: 3.4, tessellation: 32}, scene!);
      clock.rotation.x = Math.PI / 2;
      clock.position.set(-1.2, 2.4, 3.7);
      clock.material = material(scene!, "clock", "#d8be78", 0.15);
      clock.parent = root;
      const hand = MeshBuilder.CreateBox("clock-hand", {width: 0.12, height: 1.15, depth: 0.08}, scene!);
      hand.position.set(-1.2, 2.75, 3.55);
      hand.material = material(scene!, "clock-hand", "#3d342a");
      hand.parent = root;
    } else {
      for (let index = 0; index < 5; index++) {
        const stem = MeshBuilder.CreateCylinder(`stem-${index}`, {height: 0.8, diameter: 0.08}, scene!);
        stem.position.set(-3.2 + index * 1.5, 0.45, 2.2 + (index % 2) * 0.5);
        stem.material = material(scene!, `stem-material-${index}`, "#487a48");
        stem.parent = root;
        const bloom = MeshBuilder.CreateSphere(`bloom-${index}`, {diameter: 0.45, segments: 10}, scene!);
        bloom.position.set(stem.position.x, 0.95, stem.position.z);
        bloom.material = material(scene!, `bloom-material-${index}`, index % 2 ? "#d77d8d" : "#e1c45c");
        bloom.parent = root;
      }
      const cage = MeshBuilder.CreateBox("rescue-cage", {width: 1.7, height: 1.8, depth: 1.4}, scene!);
      cage.position.set(-0.4, 1.1, 2.2);
      cage.material = material(scene!, "cage", "#795d3e", 0.08);
      cage.parent = root;
    }
    return root;
  }

  async function initializeScene(): Promise<void> {
    engine = new Engine(canvas, true, {preserveDrawingBuffer: true, stencil: true});
    scene = new Scene(engine);
    scene.clearColor = new Color4(0.07, 0.09, 0.12, 1);
    camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3.1, 14, new Vector3(0, 1, 0), scene);
    camera.lowerRadiusLimit = 8;
    camera.upperRadiusLimit = 22;
    camera.attachControl(canvas, true);
    const light = new HemisphericLight("light", new Vector3(0.2, 1, -0.2), scene);
    light.intensity = 1.15;
    roomRoots = [0, 1, 2].map(buildRoom);
    player = new TransformNode("explorer", scene);
    const body = MeshBuilder.CreateCylinder("explorer-body", {height: 0.7, diameter: 0.46}, scene);
    body.material = material(scene, "explorer-body", "#d9ad52", 0.15);
    const head = MeshBuilder.CreateSphere("explorer-head", {diameter: 0.5, segments: 12}, scene);
    head.position.y = 0.55;
    head.material = material(scene, "explorer-head", "#d8cfae", 0.2);
    body.parent = player;
    head.parent = player;
    scene.onPointerObservable.add(pointerInfo => {
      if (pointerInfo.type !== PointerEventTypes.POINTERPICK || busy || session.paused) return;
      const picked = pointerInfo.pickInfo?.pickedMesh as Mesh | null;
      const destination = picked?.metadata?.destination;
      if (typeof destination === "string") move(destination);
    });
    engine.runRenderLoop(() => {
      if (!scene || !engine || disposed) return;
      const now = performance.now();
      session.advance(now - last);
      last = now;
      scene.render();
    });
    await refreshXRSupport();
    if (!disposed) {
      canvas.classList.add("ready");
      refresh();
    }
  }

  function syncScene(): void {
    if (!scene || !player) return;
    roomRoots.forEach((root, index) => root.setEnabled(index === session.room));
    const position = ROOMS[session.room].positions[session.node] || ROOMS[session.room].positions[ROOMS[session.room].nodes[0]];
    player.position.set(session.room * 16 + position[0], position[1], position[2]);
    if (camera) {
      camera.target.set(session.room * 16, 1, 0);
    }
    scene.clearColor = contrast.checked ? new Color4(0.01, 0.015, 0.02, 1) : new Color4(0.07, 0.09, 0.12, 1);
  }

  function refresh(): void {
    const room = ROOMS[session.room];
    roomTitle.textContent = `${room.name} · ${NODE_LABELS[session.node] || session.node}`;
    inventory.textContent = "Carrying: " + ([...session.inventory].join(", ") || "nothing");
    speaker.textContent = session.dialogueLine.speaker;
    dialogueText.textContent = session.dialogueLine.text;
    face.dataset.mood = session.face.mood;
    face.dataset.state = session.face.state;
    face.textContent = `Face fallback: ${session.face.mood} / ${session.face.state}`;
    destinations.replaceChildren();
    for (const destination of session.availableDestinations()) {
      const button = textButton(NODE_LABELS[destination] || destination, () => move(destination));
      button.setAttribute("aria-label", `Move to ${NODE_LABELS[destination] || destination}`);
      destinations.append(button);
    }
    if (!destinations.children.length) destinations.append(make("span", "", "No other walkable destination."));
    for (const option of [...interactionSelect.options]) {
      const item = INTERACTIONS.find(candidate => candidate.id === option.value);
      option.disabled = !item || !session.interactionAvailable(item.id);
    }
    const firstEnabled = [...interactionSelect.options].find(option => !option.disabled);
    if (firstEnabled) interactionSelect.value = firstEnabled.value;
    interactButton.disabled = busy || !firstEnabled;
    runButton.textContent = session.paused ? (session.playMs > 0 ? "Resume" : "Run") : "Pause";
    runButton.setAttribute("aria-label", runButton.textContent);
    if (session.complete) {
      roomTitle.textContent = "Adventure complete · Pip rescued";
      interactButton.disabled = true;
    }
    syncScene();
  }

  function move(destination: string): void {
    if (busy || !valid()) return;
    const result = session.moveTo(destination);
    announce(result.message);
    if (result.ok) {
      setDirty(true);
      revision++;
      audio.tone(260, 70, "sine");
      syncScene();
      refresh();
    }
  }

  function togglePause(): void {
    if (busy || !valid()) return;
    if (session.paused) {
      if (sound.checked) audio.unlock();
      session.resume();
      announce("Adventure running. Choose a destination or interaction.");
    } else {
      session.pause();
      announce("Adventure paused.");
    }
    refresh();
  }

  function interact(id: InteractionId): void {
    if (busy || !valid()) return;
    const result = session.interact(id);
    announce(result.message);
    if (result.ok) {
      audio.success();
      setDirty(true);
      revision++;
      refresh();
    } else {
      audio.tone(140, 70, "sawtooth");
    }
  }

  async function restart(): Promise<void> {
    if (busy || !valid()) return;
    session.pause();
    const atRevision = revision;
    if (windowState.dirty && host.ui.confirm &&
        !await host.ui.confirm("Start the adventure again and discard current progress?", {
          title: "Restart Clockwork Quest",
          confirmLabel: "Restart",
          cancelLabel: "Keep progress",
          danger: true,
          signal: listening.signal,
        })) return;
    if (!valid()) return;
    if (revision !== atRevision) {
      announce("Progress changed while confirming. Try again.");
      return;
    }
    clearWatch();
    session = new ClockworkQuestSession();
    savedPath = null;
    savedVersion = null;
    path.value = "/Clockwork Quest.game.json";
    delete host.w?.launchContext;
    setDirty(false);
    revision++;
    announce("Adventure reset. Press Run to begin.");
    refresh();
  }

  function clearWatch(): void {
    watchSerial++;
    watchCheck++;
    unwatch();
    unwatch = () => {};
    warning.hidden = true;
    warning.textContent = "";
  }

  function watch(context: FileContext, filePath: string, version: string): void {
    clearWatch();
    const serial = watchSerial;
    const check = async () => {
      const id = ++watchCheck;
      if (!valid() || !context.valid() || savedPath !== filePath || savedVersion !== version) return;
      let message = "";
      try {
        const current = context.files.stat ? await context.files.stat(filePath) : await context.files.read(filePath);
        message = current.status === "conflict"
          ? "This quest has conflicting copies. Resolve them in Files."
          : current.version !== version
            ? "The saved quest changed. Your current adventure is unchanged; save a copy or reopen it."
            : "";
      } catch {
        message = "The saved quest is unavailable. Your current adventure is unchanged.";
      }
      if (valid() && context.valid() && serial === watchSerial && id === watchCheck &&
          savedPath === filePath && savedVersion === version) {
        warning.textContent = message;
        warning.hidden = !message;
      }
    };
    unwatch = context.files.subscribe?.(check) || (() => {});
    queueMicrotask(check);
  }

  async function chooseFolder(): Promise<void> {
    try {
      const directory = await host.storage.pickFolder({signal: listening.signal});
      if (directory === null || !valid()) return;
      const context = await host.storage.mirrorFileContext();
      if (!valid() || !context.valid()) return;
      path.value = context.path((directory === "/" ? "" : directory) + "/" + context.name(path.value.split("/").pop() || "Clockwork Quest.game.json"));
    } catch (error) {
      announce("Could not choose folder: " + (error instanceof Error ? error.message : "unknown error"));
    }
  }

  async function open(selected?: string): Promise<void> {
    if (busy || !valid()) return;
    setBusy(true);
    session.pause();
    refresh();
    const before = encodeSave(session);
    const atRevision = revision;
    try {
      if (windowState.dirty && host.ui.confirm && !await host.ui.confirm(
        "Open a saved adventure and discard current progress?",
        {title: "Unsaved adventure", confirmLabel: "Discard progress", cancelLabel: "Keep progress", danger: true, signal: listening.signal},
      )) {
        announce("Adventure paused. Current progress kept.");
        return;
      }
      if (!valid()) return;
      if (revision !== atRevision || encodeSave(session) !== before) throw new Error("The adventure changed while confirming.");
      const choice = selected || await host.storage.pickFile({extensions: [".game.json"], signal: listening.signal});
      if (!choice || !valid()) return;
      const context = await host.storage.mirrorFileContext();
      const target = context.path(choice);
      const file = await context.files.read(target);
      if (!valid() || !context.valid()) return;
      if (file.status === "conflict") throw new Error("Resolve the file conflict in Files first.");
      if (file.data.byteLength > 2 * 1024 * 1024) throw new Error("Save file is too large.");
      const decoded = decodeSave(new TextDecoder("utf-8", {fatal: true}).decode(file.data));
      if (!valid() || revision !== atRevision) throw new Error("The adventure changed while opening.");
      const replacement = new ClockworkQuestSession(decoded.payload as QuestSnapshot);
      session = replacement;
      savedPath = target;
      savedVersion = file.version;
      path.value = target;
      setDirty(false);
      revision++;
      if (host.w) {
        host.w.launchContext = Object.freeze({version: 1, storage: "mirror", path: target, owner});
        host.w.title = target.split("/").pop() + " — Clockwork Quest";
      }
      watch(context, target, file.version);
      refresh();
      queueMicrotask(() => announce("Quest loaded and paused. Press Resume to continue."));
    } catch (error) {
      announce("Could not open quest: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      setBusy(false);
      if (valid()) refresh();
    }
  }

  async function save(): Promise<void> {
    if (busy || !valid()) return;
    const previousDirty = windowState.dirty;
    setBusy(true);
    session.pause();
    refresh();
    const requested = path.value;
    const snapshot = encodeSave(session);
    const atRevision = revision;
    setDirty(true);
    let committed = false;
    try {
      const context = await host.storage.mirrorFileContext();
      const target = context.path(requested);
      if (!target.toLowerCase().endsWith(".game.json")) throw new Error("Use a .game.json filename.");
      let expected: string | null = null;
      try {
        const old = context.files.stat ? await context.files.stat(target) : await context.files.read(target);
        if (old.status === "conflict") throw new Error("Resolve the file conflict in Files first.");
        if (target === savedPath && savedVersion) {
          if (old.version !== savedVersion) throw new Error("The saved quest changed. Save a copy or reopen it.");
        } else if (host.ui.confirm && !await host.ui.confirm("Replace " + target + "?", {
          title: "Replace saved quest", confirmLabel: "Replace", cancelLabel: "Cancel", danger: true, signal: listening.signal,
        })) {
          announce("Save cancelled. Adventure remains paused.");
          return;
        }
        expected = old.version;
      } catch (error) {
        if ((error as Error).message !== "File not found.") throw error;
        if (target === savedPath && savedVersion) throw new Error("The saved quest was removed. Save a copy or reopen it.");
      }
      if (!valid() || !context.valid()) return;
      const result = await context.files.write(target, new TextEncoder().encode(snapshot), expected);
      if (!valid() || !context.valid()) return;
      savedPath = target;
      savedVersion = result.version;
      if (path.value === requested) path.value = target;
      if (host.w) {
        host.w.launchContext = Object.freeze({version: 1, storage: "mirror", path: target, owner});
        host.w.title = target.split("/").pop() + " — Clockwork Quest";
      }
      const newer = revision !== atRevision || encodeSave(session) !== snapshot;
      windowState.dirty = newer;
      committed = true;
      watch(context, target, result.version);
      announce(result.status === "conflict"
        ? "Quest saved on this device with conflicting copies. Resolve them in Files."
        : newer
          ? "Saved the earlier quest; newer progress remains unsaved."
          : "Quest saved on this device; syncing with the server.");
    } catch (error) {
      announce("Could not save quest: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      if (!committed && valid() && revision === atRevision) windowState.dirty = previousDirty;
      setBusy(false);
    }
  }

  function suspend(): void {
    if (session.paused) return;
    session.pause();
    announce("Adventure paused when the window lost focus. Press Resume to continue.");
    refresh();
  }

  const windowObserver = new MutationObserver(() => {
    const win = element.closest<HTMLElement>(".window");
    if (win && (win.hidden || !win.classList.contains("focused") || win.classList.contains("rolled"))) suspend();
  });
  const observeWindow = () => {
    const win = element.closest<HTMLElement>(".window");
    if (win) windowObserver.observe(win, {attributes: true, attributeFilter: ["class", "hidden"]});
  };
  const visibility = () => {
    if (document.hidden) suspend();
  };
  const onBlur = () => suspend();
  const keyboard = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === "Escape") {
      event.preventDefault();
      togglePause();
      return;
    }
    if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      interact(interactionSelect.value as InteractionId);
      return;
    }
    const keys: Record<string, number> = {w: 1, s: -1, a: -1, d: 1, ArrowUp: 1, ArrowDown: -1, ArrowLeft: -1, ArrowRight: 1};
    const direction = keys[event.key] ?? keys[event.key.toLowerCase()];
    if (direction !== undefined) {
      event.preventDefault();
      const available = session.availableDestinations();
      const current = ROOMS[session.room].nodes.indexOf(session.node);
      const destination = available.find(item => {
        if (item.startsWith("go:")) return direction > 0;
        const index = ROOMS[session.room].nodes.indexOf(item);
        return direction > 0 ? index > current : index >= 0 && index < current;
      });
      if (destination) move(destination);
    }
  };
  element.addEventListener("keydown", keyboard);
  window.addEventListener("blur", onBlur, {signal: listening.signal});
  document.addEventListener("visibilitychange", visibility, {signal: listening.signal});
  sound.addEventListener("change", () => {
    volume.disabled = !sound.checked;
    audio.setMuted(!sound.checked);
    if (sound.checked) audio.unlock();
  });
  volume.addEventListener("input", () => audio.setVolume(Number(volume.value) / 100));
  motion.addEventListener("change", () => element.classList.toggle("reduced-motion", motion.checked));
  contrast.addEventListener("change", refresh);

  async function refreshXRSupport(): Promise<void> {
    const xr = (navigator as Navigator & {xr?: {isSessionSupported(mode: XRMode): Promise<boolean>}}).xr;
    xrMode = await supportedXRMode(xr);
    if (!disposed && !viewSignal.aborted) {
      xrButton.disabled = !xrMode;
      xrButton.textContent = xrMode ? "Enter XR" : "XR unavailable";
    }
  }

  async function enterXR(): Promise<void> {
    if (!scene || busy || xrBusy || !xrMode) return;
    xrBusy = true;
    xrButton.disabled = true;
    try {
      if (xrController.active) {
        await xrController.exit();
        return;
      }
      session.pause();
      refresh();
      const currentScene = scene;
      await xrController.enter(xrMode, async () => {
        const {WebXRExperienceHelper} = await import("@babylonjs/core/XR/webXRExperienceHelper.js");
        return await WebXRExperienceHelper.CreateAsync(currentScene) as unknown as XRHelperLike;
      });
      if (!valid()) return;
      xrButton.textContent = "Exit XR";
      announce("XR entered with the current room and progress. Adventure is paused.");
    } catch (error) {
      if (valid()) announce("Could not " + (xrController.active ? "exit" : "enter") + " XR: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      xrBusy = false;
      if (valid()) xrButton.disabled = !xrMode;
    }
  }

  try {
    await initializeScene();
    if (host.w?.launchContext?.storage === "mirror" && host.w.launchContext.owner === owner) {
      const initialPath = host.w.launchContext.path;
      path.value = initialPath;
      window.setTimeout(() => {
        if (valid()) void open(initialPath);
      }, 0);
    }
  } catch (error) {
    announce("Could not start the clockwork world: " + (error instanceof Error ? error.message : "unknown error"));
  }

  queueMicrotask(() => {
    if (!disposed) {
      observeWindow();
      refresh();
    }
  });

  return {
    element,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      listening.abort("View removed");
      clearWatch();
      windowObserver.disconnect();
      element.removeEventListener("keydown", keyboard);
      xrController.dispose();
      engine?.stopRenderLoop();
      scene?.dispose();
      engine?.dispose();
      scene = null;
      engine = null;
      camera = null;
      player = null;
      roomRoots = [];
      audio.dispose();
      canvas.remove();
      element.replaceChildren();
    },
  };
}
