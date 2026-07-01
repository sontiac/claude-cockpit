import { describe, it, expect, vi, beforeEach } from "vitest";

const tauriCore = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined as unknown),
  convertFileSrc: vi.fn((path: string) => path),
}));
vi.mock("@tauri-apps/api/core", () => tauriCore);

import { saveNoteContent, removeNoteContent } from "./ipc";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveNoteContent", () => {
  it("invokes save_note_content with the id and content", async () => {
    await saveNoteContent("y", { a: 1 });
    expect(tauriCore.invoke).toHaveBeenCalledWith("save_note_content", {
      id: "y",
      content: { a: 1 },
    });
  });
});

describe("removeNoteContent / saveNoteContent tombstone", () => {
  it("ignores a save for a note id whose content was already removed", async () => {
    await removeNoteContent("x");
    expect(tauriCore.invoke).toHaveBeenCalledWith("remove_note_content", {
      id: "x",
    });

    tauriCore.invoke.mockClear();

    await saveNoteContent("x", { a: 1 });
    expect(tauriCore.invoke).not.toHaveBeenCalledWith(
      "save_note_content",
      expect.anything()
    );

    // A different note id is unaffected.
    await saveNoteContent("z", { a: 1 });
    expect(tauriCore.invoke).toHaveBeenCalledWith("save_note_content", {
      id: "z",
      content: { a: 1 },
    });
  });
});
