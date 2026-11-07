import type { APIRequestContext } from "@playwright/test";
import type { PortalAcademyDto, PublicAcademyDto } from "../src/shared/api-types";
import { familyWorld } from "./scope-support";
import { expect, portalGet, test, uuid } from "./support";

// Files (spec §8): student photos, payment proof screenshots, and pickup people's photos are
// private, under ws/<academy>/clients/<student>/; logos, payment QR codes, and coach photos are the
// only public keys, under ws/<academy>/public/. One matrix of who may read what through each of the
// three file routes: the family portal's, the staff app's, and the public one.

test.use({ serviceWorkers: "block" });

type Route = "portal" | "staff" | "public";
type Who =
  | "parent"
  | "co-parent"
  | "other family, same academy"
  | "family of another academy"
  | "linked to nobody"
  | "signed out"
  | "coach"
  | "admin"
  | "owner"
  | "another academy's owner";
type Key =
  | "Mia's photo"
  | "Mia's pickup photo"
  | "Mia's payment proof"
  | "academy logo"
  | "academy payment QR"
  | "coach photo"
  | "other academy's logo"
  | "other academy's student photo";

const ROUTES: Record<Route, string> = {
  portal: "/api/portal/files/",
  staff: "/api/v1/files/",
  public: "/api/public/files/",
};

const PUBLIC_KEYS: Key[] = [
  "academy logo",
  "academy payment QR",
  "coach photo",
  "other academy's logo",
];
const FAMILIES: Who[] = [
  "parent",
  "co-parent",
  "other family, same academy",
  "family of another academy",
  "linked to nobody",
];
const OF_ACADEMY: Key[] = [
  "Mia's photo",
  "Mia's pickup photo",
  "Mia's payment proof",
  "academy logo",
  "academy payment QR",
  "coach photo",
];

/** Who may read which key through which route (200), else what they get. */
function expected(route: Route, who: Who, key: Key): number {
  if (route === "public") return PUBLIC_KEYS.includes(key) ? 200 : 404;
  if (who === "signed out") return 401;
  if (route === "staff") {
    if (FAMILIES.includes(who)) return 403; // no_workspace: families have no staff API
    if (who === "another academy's owner") return OF_ACADEMY.includes(key) ? 404 : 200;
    if (!OF_ACADEMY.includes(key)) return 404;
    // Payment proofs are money: owners and admins (money or enrollment review) only.
    return key === "Mia's payment proof" && who === "coach" ? 404 : 200;
  }
  // The family portal: linked students' own files and their academies' public images.
  switch (who) {
    case "parent":
    case "co-parent":
      return OF_ACADEMY.includes(key) ? 200 : 404;
    case "other family, same academy":
      return ["academy logo", "academy payment QR", "coach photo"].includes(key) ? 200 : 404;
    case "family of another academy":
      return ["other academy's logo", "other academy's student photo"].includes(key) ? 200 : 404;
    default:
      // Staff without a family link, and people linked to nobody.
      return 404;
  }
}

test.describe("who may read which file", () => {
  test.skip(({ isMobile }) => isMobile, "An API matrix: one browser is enough");

  test("proof and pickup photos only reach their family and the right staff; public keys live only under public/", async ({
    coach: owner,
    personas,
    playwright,
  }, info) => {
    test.slow();
    const w = await familyWorld(owner, personas, info);
    const anonymous = await playwright.request.newContext({
      baseURL: info.project.use.baseURL,
      extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    });
    try {
      const keys: Record<Key, string> = {
        "Mia's photo": w.mia.photoKey,
        "Mia's pickup photo": w.mia.pickupPhotoKey,
        "Mia's payment proof": w.mia.proofKey,
        "academy logo": w.logoKey,
        "academy payment QR": w.qrKey,
        "coach photo": w.coachPhotoKey,
        "other academy's logo": w.other.logoKey,
        "other academy's student photo": w.other.photoKey,
      };
      const people: Record<Who, APIRequestContext> = {
        parent: w.parentA.context.request,
        "co-parent": w.coParent.context.request,
        "other family, same academy": w.parentB.context.request,
        "family of another academy": w.other.family.context.request,
        "linked to nobody": w.nobody.context.request,
        "signed out": anonymous,
        coach: w.coach.context.request,
        admin: w.admin.context.request,
        owner: owner.request,
        "another academy's owner": w.other.owner.context.request,
      };

      // Where each kind of file lives.
      const ws = w.workspaceId;
      const mia = w.mia.id;
      expect(w.mia.photoKey).toMatch(new RegExp(`^ws/${ws}/clients/${mia}/[\\w-]+\\.png$`));
      expect(w.mia.pickupPhotoKey).toMatch(
        new RegExp(`^ws/${ws}/clients/${mia}/pickups/[\\w-]+\\.(jpg|png)$`),
      );
      expect(w.mia.proofKey).toMatch(
        new RegExp(`^ws/${ws}/clients/${mia}/payments/[\\w-]+\\.(jpg|png)$`),
      );
      expect(w.logoKey).toMatch(new RegExp(`^ws/${ws}/public/logo-[\\w-]+\\.png$`));
      expect(w.qrKey).toMatch(new RegExp(`^ws/${ws}/public/payment-qr-[\\w-]+\\.png$`));
      expect(w.coachPhotoKey).toMatch(new RegExp(`^ws/${ws}/public/coaches/[\\w-]+\\.png$`));

      // The matrix: every key, every person, the portal's and the staff app's routes. The public
      // route ignores who asks (it never reads a session), so it's asked by someone signed out and
      // by a parent; this keeps the run's public requests few (they share one rate limit locally).
      const seen: Record<string, number> = {};
      const want: Record<string, number> = {};
      const ask = async (route: Route, who: Who, request: APIRequestContext) => {
        for (const [key, value] of Object.entries(keys) as [Key, string][]) {
          const label = `${route}: ${key}, as ${who}`;
          want[label] = expected(route, who, key);
          seen[label] = (await request.get(`${ROUTES[route]}${value}`)).status();
        }
      };
      for (const route of ["portal", "staff"] as const) {
        for (const [who, request] of Object.entries(people) as [Who, APIRequestContext][]) {
          await ask(route, who, request);
        }
      }
      await ask("public", "signed out", anonymous);
      await ask("public", "parent", people.parent);
      expect(seen).toEqual(want);

      // Keys nobody owns, keys outside a student's known folders, and ways around the checks. A
      // client resolves "../" and "%2e%2e/" before sending, so those are aimed at a file the caller
      // may not read; an encoded slash ("..%2F") reaches the Worker as it is and is refused there.
      const file = (key: string) => key.split("/").at(-1) ?? "";
      const leo = w.leo.id;
      const otherWs = w.other.workspaceId;
      const zed = w.other.studentId;
      const tries: [string, APIRequestContext, string][] = [
        // The parent, through the portal: no other student's files, whatever the path says.
        ["portal", people.parent, `ws/${ws}/clients/${mia}/payments/${uuid()}.png`],
        ["portal", people.parent, `ws/${ws}/clients/${mia}/pickups/${uuid()}.jpg`],
        ["portal", people.parent, `ws/${ws}/clients/${mia}/notes/${uuid()}.png`],
        ["portal", people.parent, `ws/${ws}/public/../clients/${leo}/${file(w.leo.photoKey)}`],
        ["portal", people.parent, `ws/${ws}/public/%2e%2e/clients/${leo}/${file(w.leo.photoKey)}`],
        [
          "portal",
          people.parent,
          `ws/${ws}/public/..%2Fclients%2F${leo}%2F${file(w.leo.photoKey)}`,
        ],
        [
          "portal",
          people.parent,
          `ws/${ws}/clients/${mia}/pickups/..%2F..%2F${leo}%2Fpickups%2F${file(w.leo.pickupPhotoKey)}`,
        ],
        ["portal", people.parent, `ws/${ws}/public/extra/${file(w.logoKey)}`],
        // A coach, through the staff app: no payment proof by another path.
        ["staff", people.coach, `ws/${ws}/clients/${mia}/x/../payments/${file(w.mia.proofKey)}`],
        [
          "staff",
          people.coach,
          `ws/${ws}/clients/${mia}/x/..%2Fpayments%2F${file(w.mia.proofKey)}`,
        ],
        // The owner: nothing of another academy.
        ["staff", owner.request, `ws/${ws}/../${otherWs}/clients/${zed}/${file(w.other.photoKey)}`],
        [
          "staff",
          owner.request,
          `ws/${ws}/..%2F${otherWs}%2Fclients%2F${zed}%2F${file(w.other.photoKey)}`,
        ],
        // Anyone: nothing private through the public route.
        ["public", anonymous, `ws/${ws}/public/../clients/${mia}/${file(w.mia.photoKey)}`],
        ["public", anonymous, `ws/${ws}/public/..%2Fclients%2F${mia}%2F${file(w.mia.photoKey)}`],
        [
          "public",
          anonymous,
          `ws/${ws}/public/coaches/..%2F..%2Fclients%2F${mia}%2F${file(w.mia.photoKey)}`,
        ],
        ["public", anonymous, `ws/${ws}//public/${file(w.logoKey)}`],
        ["public", anonymous, `ws/${ws}/public/extra/${file(w.logoKey)}`],
      ];
      const tricks: Record<string, number> = {};
      for (const [route, request, key] of tries) {
        tricks[`${route} ${key}`] = (await request.get(`${ROUTES[route as Route]}${key}`)).status();
      }
      expect(tricks).toEqual(Object.fromEntries(Object.keys(tricks).map((k) => [k, 404])));

      // Private files are never cached by anyone in between; public ones may be, and every file is
      // sandboxed so an image can't run as a page.
      const proof = await people.parent.get(`${ROUTES.portal}${w.mia.proofKey}`);
      expect(proof.headers()["cache-control"]).toBe("no-store");
      expect(proof.headers()["content-security-policy"]).toContain("sandbox");
      expect(proof.headers()["x-content-type-options"]).toBe("nosniff");
      const staffCopy = await owner.request.get(`${ROUTES.staff}${w.mia.pickupPhotoKey}`);
      expect(staffCopy.headers()["cache-control"]).toBe("no-store");
      const logo = await anonymous.get(`${ROUTES.public}${w.logoKey}`);
      expect(logo.headers()["cache-control"]).toBe("public, max-age=3600");
      expect(logo.headers()["content-security-policy"]).toContain("sandbox");
      expect(logo.headers()["content-type"]).toBe("image/png");

      // What the public page and the portal point at is public; the public page never names a
      // private key (or the payment QR, which is for families).
      const page = (await (
        await anonymous.get(`/api/public/academies/${w.slug}`)
      ).json()) as PublicAcademyDto;
      const pageKeys = [page.logoKey, page.coverKey, ...page.coaches.map((c) => c.photoKey)].filter(
        (k): k is string => Boolean(k),
      );
      expect(pageKeys.length).toBeGreaterThan(0);
      for (const k of pageKeys) expect(k).toMatch(new RegExp(`^ws/${ws}/public/`));
      const pageText = JSON.stringify(page);
      for (const k of [w.mia.photoKey, w.mia.pickupPhotoKey, w.mia.proofKey, w.qrKey]) {
        expect(pageText).not.toContain(k);
      }
      const academy = await portalGet<PortalAcademyDto>(people.parent, `/academies/${ws}`);
      for (const k of [academy.logoKey, academy.paymentQrKey].filter(Boolean)) {
        expect(k).toMatch(new RegExp(`^ws/${ws}/public/`));
      }
    } finally {
      await anonymous.dispose();
    }
  });
});
