import { object, string } from "./validation.js";
import type { AuthorProfile } from "./types.js";

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
  return profile;
}
