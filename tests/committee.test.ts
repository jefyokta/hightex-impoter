import { expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { parseHighTexV2, readAuthorProfile } from "../src/index.js";

const encode = (value: unknown) => strToU8(JSON.stringify(value));
const committee = {
  chair: { id: "17", name: "Chair, M.Kom.", nip: "001700" },
  examiner1: { name: "Legacy Examiner", nip: "" },
  examiner2: { id: "29", name: "Examiner Two", nip: "002900" },
};
const archive = (profile: unknown, inManifest = false) =>
  zipSync({
    "manifest.json": encode({
      schema_version: 2,
      format: "json",
      document: { id: "a" },
      ...(inManifest ? { profile } : {}),
    }),
    ...(!inManifest ? { "files/profile.json": encode(profile) } : {}),
    "files/config.json": encode({
      leader: "Old chair",
      member_1: "Old examiner",
    }),
  });

test("committee survives v2 parsing and serialization, including legacy names without IDs", () => {
  for (const inManifest of [false, true]) {
    const model = parseHighTexV2(
      archive({ name: "Student", committee }, inManifest),
    );
    expect(model.profile?.committee).toEqual(committee);
    expect(parseHighTexV2(archive(model.profile)).profile?.committee).toEqual(
      committee,
    );
    expect(model.config.leader).toBe("Old chair");
    expect(model.manifest.schema_version).toBe(2);
  }
});

test("old profiles stay unchanged and explicit empty committees stay empty", () => {
  expect(
    parseHighTexV2(archive({ name: "Old author" })).profile?.committee,
  ).toBeUndefined();
  expect(parseHighTexV2(archive({ committee: {} })).profile?.committee).toEqual(
    {},
  );
  expect(readAuthorProfile(undefined, "profile")).toBeUndefined();
});

test.each([
  { committee: null },
  { committee: [] },
  { committee: { chair: null } },
  { committee: { chair: { name: 1, nip: "" } } },
  { committee: { examiner1: { name: "A", nip: 123 } } },
  { committee: { examiner2: { id: 2, name: "A", nip: "" } } },
  { committee: { chair: { name: "A" } } },
])("malformed committee fails validation: %p", (profile) => {
  expect(() => parseHighTexV2(archive(profile))).toThrow();
});
