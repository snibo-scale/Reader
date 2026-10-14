import { expect, it } from "vitest";
import { relativeDate } from "./util";

const now = Date.parse("2026-09-23T12:00:00.000Z");
const ago = (days: number) => new Date(now - days * 86400000).toISOString();

it("formats relative ages", () => {
  expect(relativeDate(ago(0), now)).toBe("today");
  expect(relativeDate(ago(1), now)).toBe("yesterday");
  expect(relativeDate(ago(5), now)).toBe("5d ago");
  expect(relativeDate(ago(45), now)).toBe("1mo ago");
  expect(relativeDate(ago(400), now)).toBe("1y ago");
  expect(relativeDate("garbage", now)).toBe("");
});
