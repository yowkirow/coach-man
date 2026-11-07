import { describe, expect, it } from "vitest";
import {
  clientPackageUpdateSchema,
  clientUpdateSchema,
  eventSchema,
  goalSchema,
  groupSchema,
  noteUpdateSchema,
  packageTemplateUpdateSchema,
  rateSchema,
  skillSchema,
  venueSchema,
  workspaceUpdateSchema,
} from "../../src/shared/schemas";

// PATCH bodies must only contain what the client sent. Zod 4's .partial() still applies inner
// .default()s, which silently reset omitted fields (a client's last name, a package's session types).
const PATCH_SCHEMAS = {
  client: clientUpdateSchema,
  packageTemplate: packageTemplateUpdateSchema,
  rate: rateSchema.partial(),
  group: groupSchema.partial(),
  event: eventSchema.partial(),
  venue: venueSchema.partial(),
  skill: skillSchema.partial(),
  goal: goalSchema.partial(),
  workspace: workspaceUpdateSchema,
  clientPackage: clientPackageUpdateSchema,
  note: noteUpdateSchema,
};

describe("PATCH schemas", () => {
  for (const [name, schema] of Object.entries(PATCH_SCHEMAS)) {
    it(`${name}: an empty body changes nothing`, () => {
      expect(schema.parse({})).toEqual({});
    });
  }

  it("pausing a client leaves the rest of the profile alone", () => {
    expect(clientUpdateSchema.parse({ status: "paused" })).toEqual({ status: "paused" });
  });

  it("renaming a package keeps its session types", () => {
    expect(packageTemplateUpdateSchema.parse({ name: "Summer 8-pack" })).toEqual({
      name: "Summer 8-pack",
    });
  });

  it("still validates the fields that are sent", () => {
    expect(() => clientUpdateSchema.parse({ firstName: "" })).toThrow();
    expect(clientUpdateSchema.parse({ lastName: "  Reyes " })).toEqual({ lastName: "Reyes" });
  });
});
