import { matchRegexTexts } from "./regexSearch";

export interface RegexSearchRequest {
  id: number;
  pattern: string;
  texts: string[];
}

export interface RegexSearchReply {
  id: number;
  matches: boolean[];
}

// The DOM lib types `self` as a window; this file only ever runs as a dedicated worker.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RegexSearchRequest>) => void) | null;
  postMessage: (reply: RegexSearchReply) => void;
};

scope.onmessage = ({ data }) => {
  scope.postMessage({ id: data.id, matches: matchRegexTexts(data.pattern, data.texts) });
};
