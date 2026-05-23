// Side-effect imports: each provider file calls registerProvider() at module scope
import "./providers/gemini";
import "./providers/piper";
import "./providers/google-cloud";

// Provider types & registry
export type {
  TTSProvider,
  TTSProviderClass,
  Voice,
  TTSOptions,
  PlaybackOptions,
  Sentence,
} from "./providers/types";

export {
  registerProvider,
  getProvider,
  listProviders,
} from "./providers/registry";

// Text utilities
export {
  tokenizeSentences,
  normalizeText,
  haveSpeakableText,
  getSpeakableText,
  md5,
} from "./text-utils";

// Audio cache
export { AudioCache } from "./audio-cache";

// Fluency adjuster
export { FluentnessAdjuster } from "./fluency-adjuster";

// PiP background locker
export { PIPLocker } from "./pip-locker";

// Player engine
export { Player } from "./player";
export type { PlayerCallbacks, PlayState } from "./player";
