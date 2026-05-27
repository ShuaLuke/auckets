import { describe, expect, it } from "vitest";

import { uuidParam } from "./uuid";

describe("uuidParam", () => {
  it("accepts a real gen_random_uuid()-style v4 UUID", () => {
    // Generated via crypto.randomUUID() — version nibble 4, variant nibble 8-b.
    expect(uuidParam.safeParse("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d").success).toBe(true);
  });

  it("accepts seed-style mnemonic UUIDs that z.uuid() rejects", () => {
    // These are intentionally not RFC-9562 compliant (variant nibble != 8/9/a/b).
    // z.uuid() rejects them in Zod 4; uuidParam accepts them.
    for (const id of [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
      "44444444-4444-4444-4444-444444444444",
    ]) {
      expect(uuidParam.safeParse(id).success).toBe(true);
    }
  });

  it("accepts uppercase hex", () => {
    expect(uuidParam.safeParse("9B1DEB4D-3B7D-4BAD-9BDD-2B0D7B3DCB6D").success).toBe(true);
  });

  it("accepts the all-zeros and all-fs forms", () => {
    expect(uuidParam.safeParse("00000000-0000-0000-0000-000000000000").success).toBe(true);
    expect(uuidParam.safeParse("ffffffff-ffff-ffff-ffff-ffffffffffff").success).toBe(true);
  });

  it("rejects non-hex characters", () => {
    expect(uuidParam.safeParse("gggggggg-gggg-gggg-gggg-gggggggggggg").success).toBe(false);
  });

  it("rejects wrong segment lengths", () => {
    expect(uuidParam.safeParse("1234567-1234-1234-1234-123456789012").success).toBe(false);
    expect(uuidParam.safeParse("12345678-1234-1234-1234-12345678901").success).toBe(false);
    expect(uuidParam.safeParse("12345678123412341234123456789012").success).toBe(false);
  });

  it("rejects empty string and obvious garbage", () => {
    expect(uuidParam.safeParse("").success).toBe(false);
    expect(uuidParam.safeParse("not-a-uuid").success).toBe(false);
    expect(uuidParam.safeParse("../etc/passwd").success).toBe(false);
  });

  it("rejects trailing characters (full-string anchor check)", () => {
    expect(
      uuidParam.safeParse("44444444-4444-4444-4444-444444444444 ").success,
    ).toBe(false);
    expect(
      uuidParam.safeParse("44444444-4444-4444-4444-444444444444/extra").success,
    ).toBe(false);
  });
});
