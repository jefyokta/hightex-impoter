import { object, string } from "./validation.js";
import type { AcademicCommittee, AuthorProfile } from "./types.js";

export function readProfile(
  value: unknown,
  path: string,
): AuthorProfile | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = object(value, path);
  const profile: AuthorProfile = {
    name: "",
    nim: "",
    advisorName: "",
    advisorNip: "",
    cv: "",
  };
  for (const key of ["name", "nim", "advisorName", "advisorNip", "cv"] as const)
    if (raw[key] !== undefined)
      profile[key] = string(raw[key], `${path}.${key}`);
  if (raw.secondAdvisor !== undefined && raw.secondAdvisor !== null) {
    const second = object(raw.secondAdvisor, `${path}.secondAdvisor`);
    profile.secondAdvisor = {
      name: string(second.name, `${path}.secondAdvisor.name`),
      nip: string(second.nip, `${path}.secondAdvisor.nip`),
    };
  }
  if (raw.committee !== undefined) {
    const rawCommittee = object(raw.committee, `${path}.committee`);
    const committee: AcademicCommittee = {};
    for (const key of ["chair", "examiner1", "examiner2"] as const) {
      if (rawCommittee[key] === undefined) continue;
      const personPath = `${path}.committee.${key}`;
      const person = object(rawCommittee[key], personPath);
      committee[key] = {
        name: string(person.name, `${personPath}.name`),
        nip: string(person.nip, `${personPath}.nip`),
        ...(person.id !== undefined
          ? { id: string(person.id, `${personPath}.id`) }
          : {}),
      };
    }
    profile.committee = committee;
  }
  return profile;
}
