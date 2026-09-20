import { describe, expect, it } from "vitest";
import { planFlushSettlement } from "../../src/flush-settlement.js";

describe("planFlushSettlement", () => {
  it("settles a normal partial failure through the first failed batch", () => {
    expect(planFlushSettlement([true, false, true], false)).toEqual({
      processIndexes: [0],
      restoreIndexes: [1, 2],
      frontierIndexes: [0],
    });
  });

  it("processes completed batches behind a cancelled hole without advancing past it", () => {
    expect(planFlushSettlement([true, false, true], true)).toEqual({
      processIndexes: [0, 2],
      restoreIndexes: [1],
      frontierIndexes: [0],
    });
  });

  it("advances the cancellation frontier through a contiguous completed prefix", () => {
    expect(planFlushSettlement([true, true, false], true)).toEqual({
      processIndexes: [0, 1],
      restoreIndexes: [2],
      frontierIndexes: [0, 1],
    });
  });
});
