// Types
export type {
  Profile,
  ProfileSummary,
  ProfileStore,
  CreateProfileInput,
  UpdateProfileInput,
} from "./types.js";

// Store (low-level file I/O)
export {
  getConfigDir,
  getStorePath,
  ensureDir,
  loadStore,
  saveStore,
} from "./store.js";

// Manager (high-level CRUD operations)
export {
  list,
  get,
  getActiveId,
  getActive,
  setActive,
  create,
  update,
  remove,
  createFromEnv,
  clearCache,
} from "./manager.js";
