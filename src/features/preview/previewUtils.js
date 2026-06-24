import { collectFrontendFiles } from "../fullstack/fullstackBundler";

/** Fingerprint frontend workspace files to detect edits for live rebuild. */
export const fingerprintFrontend = (detection, fileContents) => {
  if (!detection?.folder || detection.kind === "empty") return "";
  const files = collectFrontendFiles(detection.folder, fileContents || {});
  if (files.length === 0) return "";
  let hash = 0;
  const blob = files
    .map(({ path, content }) => `${path}\0${content ?? ""}`)
    .join("\n");
  for (let i = 0; i < blob.length; i += 1) {
    hash = ((hash << 5) - hash + blob.charCodeAt(i)) | 0;
  }
  return `${files.length}:${hash}`;
};

export const BUILD_STAGE_ORDER = ["collect", "init", "bundle", "compose"];

export const BUILD_STAGE_LABELS = {
  collect: "Reading files",
  init: "Booting bundler",
  bundle: "Compiling",
  compose: "Composing preview",
};

export const BUILD_STAGE_PROGRESS = {
  collect: 12,
  init: 32,
  bundle: 72,
  compose: 92,
};

export const shortContractId = (id) => (
  id && id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id || ""
);
