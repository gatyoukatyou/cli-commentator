import type { Profile } from "@cli-commentator/shared";

export type {
  CreateProfileInput,
  Profile,
  ProfileLLMProviders,
  ProfileSummary,
  UpdateProfileInput,
} from "@cli-commentator/shared";

export type ProfileStore = {
  version: 1;
  activeId: string | null;
  profiles: Profile[];
};
