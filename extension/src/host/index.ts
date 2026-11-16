/**
 * The extension's Copilot host: what the panel hands the shared loop.
 *
 * Per question the panel reads a fresh `SellerSession`, builds the system
 * prompt and the tool context from it, and runs `runAgent` with
 * `EXTENSION_TOOLKIT`. Nothing here imports React or the panel.
 */
export { EXT_ACTIONS, type ExtActionId } from './actions';
export {
  buildExtensionSystem,
  extensionPromptHost,
  type ExtensionSystemInput,
} from './prompt';
export { EXTENSION_TOOLKIT, createExtToolContext, type ExtToolContextInput } from './toolkit';
