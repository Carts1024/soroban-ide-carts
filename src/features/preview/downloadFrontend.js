/**
 * Bundles the detected frontend folder from the IDE workspace into a `.zip`
 * and triggers a browser download so the user can run `npm install &&
 * npm run dev` on their own machine.
 *
 * Lazily imports JSZip to keep it out of the main bundle — most users
 * won't ever click the button.
 */
import { collectFrontendFiles, detectFrontendRoot } from "../fullstack/fullstackBundler";

const sanitizeFolderName = (raw) =>
  (raw || "frontend")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "frontend";

/**
 * Decode the `fileContents` value for a single workspace file into the bytes
 * we should write into the zip. Text files are stored as their raw string;
 * uploaded binaries (base64) are decoded back into bytes.
 */
const toEntryBytes = (content) => {
  if (typeof content !== "string") return new Uint8Array();
  // Heuristic: files uploaded as binaries are stored as base64 (no data:
  // prefix — that prefix is filtered out earlier in the bundler). Detect
  // by exclusion: short strings or ones containing whitespace are text.
  const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(content) && content.length > 32;
  if (!looksBase64) return content;
  try {
    const bin = atob(content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return content;
  }
};

/**
 * Build + download the zip. Resolves to the chosen filename, or rejects on
 * any error so callers can show a useful message.
 */
export const downloadFrontendZip = async (treeData, fileContents) => {
  const detection = detectFrontendRoot(treeData);
  if (!detection.folder) {
    throw new Error("No workspace loaded");
  }

  const files = collectFrontendFiles(detection.folder, fileContents);
  if (files.length === 0) {
    throw new Error(`No deployable files found in ${detection.name || "the workspace"}`);
  }

  // Dynamic import keeps JSZip out of the main chunk.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const rootName = sanitizeFolderName(detection.name);
  const folder = zip.folder(rootName);

  for (const { path, content } of files) {
    folder.file(path, toEntryBytes(content));
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const filename = `${rootName}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Free the blob once the browser has had a chance to consume it.
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  return { filename, fileCount: files.length, folderName: rootName };
};
