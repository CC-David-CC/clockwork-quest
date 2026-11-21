import {describe, expect, it} from "./test-shim.ts";
import {
  ClockworkQuestSession,
  SaveError,
  decodeSave,
  encodeSave,
} from "../src/model/quest.ts";

function playThrough(): ClockworkQuestSession {
  const session = new ClockworkQuestSession();
  session.resume();
  expect(session.moveTo("workbench").ok).toBe(true);
  expect(session.interact("inspect-gear").ok).toBe(true);
  expect(session.interact("turn-crank").ok).toBe(true);
  expect(session.moveTo("clock-door").ok).toBe(true);
  expect(session.moveTo("go:clock-hall").ok).toBe(true);
  expect(session.room).toBe(1);
  expect(session.inventory.has("brass-key")).toBe(true);
  expect(session.moveTo("switches").ok).toBe(true);
  expect(session.interact("set-minute").ok).toBe(true);
  expect(session.interact("set-hour").ok).toBe(true);
  expect(session.interact("take-mainspring").ok).toBe(true);
  expect(session.moveTo("conservatory-door").ok).toBe(true);
  expect(session.moveTo("go:conservatory").ok).toBe(true);
  expect(session.room).toBe(2);
  expect(session.moveTo("cage").ok).toBe(true);
  expect(session.interact("unlock-cage").ok).toBe(true);
  return session;
}

describe("Clockwork Quest rules", () => {
  it("requires an explicit resume before movement or interaction", () => {
    const session = new ClockworkQuestSession();
    expect(session.moveTo("workbench")).toMatchObject({ok: false, message: expect.stringMatching(/paused/i)});
    expect(session.interact("inspect-gear").ok).toBe(false);
  });

  it("rejects unreachable destinations and interactions across a closed wall", () => {
    const session = new ClockworkQuestSession();
    session.resume();
    expect(session.moveTo("clock-door").ok).toBe(false);
    expect(session.interact("unlock-cage").ok).toBe(false);
    expect(session.moveTo("workbench").ok).toBe(true);
    expect(session.interact("turn-crank").ok).toBe(false);
  });

  it("completes both path puzzles and the companion rescue", () => {
    const session = playThrough();
    expect(session.complete).toBe(true);
    expect(session.flags.companionFreed).toBe(true);
    expect(session.dialogueLine.speaker).toBe("Pip");
    expect(session.interactions.size).toBe(6);
  });

  it("does not duplicate inventory during room transitions", () => {
    const session = new ClockworkQuestSession();
    session.resume();
    session.moveTo("workbench");
    session.interact("inspect-gear");
    session.interact("turn-crank");
    session.moveTo("clock-door");
    session.moveTo("go:clock-hall");
    session.moveTo("go:clock-hall");
    expect([...session.inventory]).toEqual(["brass-key"]);
  });

  it("restores dialogue branch, room, inventory and puzzle state", () => {
    const original = new ClockworkQuestSession();
    original.resume();
    original.moveTo("workbench");
    original.interact("inspect-gear");
    const restored = new ClockworkQuestSession(decodeSave(encodeSave(original)).payload);
    expect(restored.room).toBe(0);
    expect(restored.dialogue).toBe("gear");
    expect(restored.dialogueLine.speaker).toBe("Tock");
    expect(restored.inventory.has("brass-key")).toBe(true);
    expect(restored.paused).toBe(true);
  });

  it("rejects malformed, inconsistent and oversized saves", () => {
    expect(() => decodeSave("{}")).toThrow(SaveError);
    const session = new ClockworkQuestSession();
    const payload = session.snapshot();
    payload.flags.workshopDoorOpen = true;
    expect(() => new ClockworkQuestSession(payload)).toThrow(SaveError);
    expect(() => decodeSave(" ".repeat(2 * 1024 * 1024 + 1))).toThrow(/size limit/);
  });

  it("derives presentation face state without treating it as gameplay", () => {
    const session = new ClockworkQuestSession();
    const initial = session.face;
    expect(initial).toMatchObject({mood: "worried", state: "idle", speaking: false});
    session.resume();
    session.moveTo("workbench");
    session.interact("inspect-gear");
    expect(session.face).toMatchObject({mood: "worried", state: "talk", speaking: true});
  });
});
