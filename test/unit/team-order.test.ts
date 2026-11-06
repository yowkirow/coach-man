import { describe, expect, it } from "vitest";
import { portraitCrop, portraitSize } from "../../src/app/lib/image-crop";
import {
  nextTeamPagePlace,
  reorderTeamPage,
  type TeamPageItem,
  teamPageOrder,
} from "../../src/worker/lib/team-page";

const staff = (id: string, name: string, sortOrder = 0): TeamPageItem => ({
  kind: "staff",
  id,
  name,
  sortOrder,
});
const person = (id: string, name: string, sortOrder = 0): TeamPageItem => ({
  kind: "listed",
  id,
  name,
  sortOrder,
});
const names = (items: TeamPageItem[]) => items.map((i) => i.name);

describe("the team page's order", () => {
  it("merges staff and display-only people by the academy's order, then by name", () => {
    expect(
      names(
        teamPageOrder(
          [staff("u1", "Robin", 2), staff("u2", "Ana", 0), staff("u3", "Sam", 2)],
          [person("p1", "Ben", 1), person("p2", "Carla", 2)],
        ),
      ),
    ).toEqual(["Ana", "Ben", "Carla", "Robin", "Sam"]);
  });

  it("puts people at the same place in name order (profiles from before the page had an order)", () => {
    // Profiles made before places were handed out all sit at 0.
    expect(
      names(
        teamPageOrder(
          [staff("u1", "Sam"), staff("u2", "Ana")],
          [person("p1", "Zoe", 1), person("p2", "Ben", 2)],
        ),
      ),
    ).toEqual(["Ana", "Sam", "Zoe", "Ben"]);
  });

  it("never wobbles on a tie: staff first, then by id", () => {
    const tie = [person("p2", "Kim"), staff("u9", "Kim"), person("p1", "Kim")];
    const once = teamPageOrder(
      tie.filter((t) => t.kind === "staff"),
      tie.filter((t) => t.kind === "listed"),
    );
    expect(once.map((t) => `${t.kind}:${t.id}`)).toEqual(["staff:u9", "listed:p1", "listed:p2"]);
    const again = teamPageOrder(
      [...once].reverse().filter((t) => t.kind === "staff"),
      [...once.filter((t) => t.kind === "listed").reverse()],
    );
    expect(again).toEqual(once);
  });

  it("leaves the lists it was given alone", () => {
    const a = [staff("u1", "Sam", 1)];
    const b = [person("p1", "Ana", 0)];
    teamPageOrder(a, b);
    expect(names(a)).toEqual(["Sam"]);
    expect(names(b)).toEqual(["Ana"]);
  });
});

describe("where someone new goes on the team page", () => {
  it("is one past the highest place, staff or display-only, or first on an empty page", () => {
    expect(nextTeamPagePlace([])).toBe(0);
    expect(nextTeamPagePlace([null, undefined])).toBe(0);
    expect(nextTeamPagePlace([0, null])).toBe(1);
    expect(nextTeamPagePlace([3, 7])).toBe(8);
    expect(nextTeamPagePlace([9, 2])).toBe(10);
  });

  it("never lands above an order the academy arranged, whatever their name", () => {
    // The academy arranged Zoe, Yuri (who doesn't sign in), then Xavi; Aaron joins after.
    const arranged = [staff("u1", "Zoe", 0), staff("u2", "Xavi", 2)];
    const people = [person("p1", "Yuri", 1)];
    const aaron = staff("u3", "Aaron", nextTeamPagePlace([2, 1]));
    expect(names(teamPageOrder([...arranged, aaron], people))).toEqual([
      "Zoe",
      "Yuri",
      "Xavi",
      "Aaron",
    ]);
    // A display-only person added next goes after Aaron.
    const ben = person("p2", "Ben", nextTeamPagePlace([aaron.sortOrder, 1]));
    expect(names(teamPageOrder([...arranged, aaron], [...people, ben]))).toEqual([
      "Zoe",
      "Yuri",
      "Xavi",
      "Aaron",
      "Ben",
    ]);
  });
});

describe("a new order for the team page", () => {
  const current = [staff("u1", "Ana"), person("p1", "Ben"), staff("u2", "Carla")];

  it("puts everyone where the request says", () => {
    expect(
      names(
        reorderTeamPage(current, [
          { kind: "staff", id: "u2" },
          { kind: "staff", id: "u1" },
          { kind: "listed", id: "p1" },
        ]),
      ),
    ).toEqual(["Carla", "Ana", "Ben"]);
  });

  it("keeps people the request left out after the ones it names, in their order", () => {
    expect(names(reorderTeamPage(current, [{ kind: "staff", id: "u2" }]))).toEqual([
      "Carla",
      "Ana",
      "Ben",
    ]);
  });

  it("skips people who aren't on the page, the wrong kind of id, and repeats", () => {
    expect(
      names(
        reorderTeamPage(current, [
          { kind: "listed", id: "gone" },
          { kind: "listed", id: "u1" },
          { kind: "listed", id: "p1" },
          { kind: "listed", id: "p1" },
          { kind: "staff", id: "u2" },
        ]),
      ),
    ).toEqual(["Ben", "Carla", "Ana"]);
  });
});

describe("a team page photo's crop", () => {
  it("keeps the head of a tall photo: full width, 10% of the extra height cut from the top", () => {
    // 1000 × 2000: a 1000 × 1250 crop leaves 750 px over; 75 go from the top, 675 from the bottom.
    expect(portraitCrop(1000, 2000)).toEqual({ x: 0, y: 75, width: 1000, height: 1250 });
    expect(portraitCrop(3024, 4032)).toEqual({ x: 0, y: 25, width: 3024, height: 3780 });
  });

  it("centers a wide photo, at full height", () => {
    expect(portraitCrop(2000, 1000)).toEqual({ x: 600, y: 0, width: 800, height: 1000 });
    expect(portraitCrop(4032, 3024)).toEqual({ x: 806, y: 0, width: 2419, height: 3024 });
    // Square.
    expect(portraitCrop(1000, 1000)).toEqual({ x: 100, y: 0, width: 800, height: 1000 });
  });

  it("keeps a photo that is already 4:5 whole", () => {
    expect(portraitCrop(800, 1000)).toEqual({ x: 0, y: 0, width: 800, height: 1000 });
    expect(portraitCrop(1280, 1600)).toEqual({ x: 0, y: 0, width: 1280, height: 1600 });
  });

  it("never gives an empty crop or one outside a tiny picture", () => {
    for (const [w, h] of [
      [1, 1],
      [1, 50],
      [50, 1],
      [3, 2],
      [2, 3],
      [0, 0],
    ] as const) {
      const c = portraitCrop(w, h);
      expect(c.width, `${w}×${h}`).toBeGreaterThanOrEqual(1);
      expect(c.height, `${w}×${h}`).toBeGreaterThanOrEqual(1);
      expect(c.x + c.width, `${w}×${h}`).toBeLessThanOrEqual(Math.max(1, w));
      expect(c.y + c.height, `${w}×${h}`).toBeLessThanOrEqual(Math.max(1, h));
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
    }
    expect(portraitCrop(1, 50)).toEqual({ x: 0, y: 5, width: 1, height: 1 });
  });

  it("draws at most maxEdge tall, 4:5, and never enlarges", () => {
    expect(portraitSize(portraitCrop(3024, 4032), 1600)).toEqual({ width: 1280, height: 1600 });
    expect(portraitSize(portraitCrop(4032, 3024), 1600)).toEqual({ width: 1280, height: 1600 });
    expect(portraitSize(portraitCrop(400, 500), 1600)).toEqual({ width: 400, height: 500 });
    expect(portraitSize(portraitCrop(300, 300), 1600)).toEqual({ width: 240, height: 300 });
  });
});
