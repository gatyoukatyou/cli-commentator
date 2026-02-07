export {
  createPTYManager,
  configFromProfile,
  configFromEnv,
  isNodePtyAvailable,
  getNodePtyError,
  type PTYConfig,
  type PTYManager,
} from "./manager.js";

export {
  classifyPtyFailure,
  createPtyUnavailableMessage,
  getErrorMessage,
  PTY_UNAVAILABLE_SUGGESTION,
  type PtyFailure,
} from "./unavailable.js";
