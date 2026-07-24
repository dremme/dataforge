/**
 * Shared HTTP transport and browse/error helpers only.
 * Domain API clients live under each feature api folder and must not be re-exported here
 * (keeps shared from depending on features).
 */
export {
  BACKEND_UNREACHABLE,
  FOLDER_NOT_FOUND,
  FOLDER_NOT_FOUND_MESSAGE,
  formatApiError,
  isFolderNotFoundError,
  requestJson,
  resolveBrowseError,
  type BrowseError,
} from "./http";
