import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_STAGE, findLocalStage, LOCAL_STAGES } from "./localStages";

describe("findLocalStage", () => {
  it("finds the stage matching a given type", () => {
    expect(findLocalStage("completed")).toEqual({ name: "Done", type: "completed" });
  });

  it("returns undefined for a type local tasks don't use (e.g. triage)", () => {
    expect(findLocalStage("triage")).toBeUndefined();
  });
});

describe("DEFAULT_LOCAL_STAGE", () => {
  it("is the unstarted-type stage", () => {
    expect(DEFAULT_LOCAL_STAGE.type).toBe("unstarted");
    expect(LOCAL_STAGES).toContain(DEFAULT_LOCAL_STAGE);
  });
});
