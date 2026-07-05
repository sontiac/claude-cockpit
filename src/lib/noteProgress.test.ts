import { describe, it, expect } from "vitest";
import { taskProgress } from "./noteProgress";

describe("taskProgress", () => {
  it("returns 0/0 for empty or missing docs", () => {
    expect(taskProgress(null)).toEqual({ done: 0, total: 0 });
    expect(taskProgress(undefined)).toEqual({ done: 0, total: 0 });
    expect(taskProgress({ type: "doc", content: [] })).toEqual({ done: 0, total: 0 });
    expect(taskProgress({ type: "doc", content: [{ type: "paragraph" }] })).toEqual({
      done: 0,
      total: 0,
    });
  });

  it("counts checked and unchecked task items", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] },
            { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] },
            { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph" }] },
          ],
        },
      ],
    };
    expect(taskProgress(doc)).toEqual({ done: 2, total: 3 });
  });

  it("counts nested task lists (task items inside task items)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                { type: "paragraph" },
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: true },
                      content: [{ type: "paragraph" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(taskProgress(doc)).toEqual({ done: 1, total: 2 });
  });

  it("treats a task item without attrs as unchecked", () => {
    const doc = {
      type: "doc",
      content: [{ type: "taskList", content: [{ type: "taskItem" }] }],
    };
    expect(taskProgress(doc)).toEqual({ done: 0, total: 1 });
  });
});
