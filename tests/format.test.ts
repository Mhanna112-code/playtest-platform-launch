import { describe, expect, it } from "vitest";
import { compact, compactMoney, money, num } from "@/lib/format";

describe("number format (design doc 2)", () => {
  it("counts and money use thousands separators; money is always exact", () => {
    expect(num(1240)).toBe("1,240");
    expect(money(1240350)).toBe("$12,403.50");
    expect(money(5)).toBe("$0.05");
    expect(money(-250)).toBe("-$2.50");
  });
  it("big tiles: full under 10,000, then k, M, B, T, then × 10^N, with no trailing .0", () => {
    expect(compact(9999)).toBe("9,999");
    expect(compact(10_000)).toBe("10k");
    expect(compact(12_400)).toBe("12.4k");
    expect(compact(999_949)).toBe("999.9k");
    expect(compact(999_950)).toBe("1M");
    expect(compact(1_200_000)).toBe("1.2M");
    expect(compact(3_000_000_000)).toBe("3B");
    expect(compact(4_500_000_000_000)).toBe("4.5T");
    expect(compact(1.2e15)).toBe("1.2 × 10^15");
    expect(compact(1e15)).toBe("1 × 10^15");
    expect(compact(9.96e17)).toBe("1 × 10^18");
  });
  it("money tiles: exact under $10,000, abbreviated above", () => {
    expect(compactMoney(420350)).toBe("$4,203.50");
    expect(compactMoney(1_240_000)).toBe("$12.4k");
    expect(compactMoney(100_000_000)).toBe("$1M");
  });
});
