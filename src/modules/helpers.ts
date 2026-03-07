/**
 * Shared helper functions used across provider clients.
 */

/**
 * Infer MIME type from filename extension
 */
export function inferMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    csv: "text/csv",
    json: "application/json",
    txt: "text/plain",
    md: "text/markdown",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    py: "text/x-python",
    js: "text/javascript",
    ts: "text/typescript",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

/**
 * Infer programming language from file path extension
 */
export function inferLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    py: "python",
    js: "javascript",
    ts: "typescript",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    sh: "bash",
    sql: "sql",
    r: "r",
    jl: "julia",
  };
  return langMap[ext || ""] || "python";
}

/**
 * Convert MIME type to file extension
 */
export function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/json": "json",
    "application/pdf": "pdf",
  };
  return map[mimeType] || "bin";
}

/**
 * Extract code from incrementally building JSON for Claude's streaming
 * text_editor_code_execution format: {"command":"create","path":"...","file_text":"..."}
 */
export function extractCodeFromPartialJson(
  jsonSoFar: string,
  lastExtractedLength: number
): { newCode: string; totalLength: number } {
  const fileTextMatch = jsonSoFar.match(/"file_text"\s*:\s*"/);
  if (!fileTextMatch) {
    return { newCode: "", totalLength: lastExtractedLength };
  }

  const startIndex = fileTextMatch.index! + fileTextMatch[0].length;

  let content = "";
  let i = startIndex;
  while (i < jsonSoFar.length) {
    const char = jsonSoFar[i];
    if (char === "\\") {
      if (i + 1 < jsonSoFar.length) {
        const nextChar = jsonSoFar[i + 1];
        if (nextChar === "n") {
          content += "\n";
        } else if (nextChar === "t") {
          content += "\t";
        } else if (nextChar === "r") {
          content += "\r";
        } else if (nextChar === '"') {
          content += '"';
        } else if (nextChar === "\\") {
          content += "\\";
        } else {
          content += nextChar;
        }
        i += 2;
        continue;
      }
      break;
    } else if (char === '"') {
      break;
    } else {
      content += char;
      i++;
    }
  }

  const newCode = content.slice(lastExtractedLength);
  return { newCode, totalLength: content.length };
}

/**
 * Parse a JSON response containing mean, median, std from model text
 */
export function parseResponse(text: string): { mean: number; median: number; std: number } | null {
  const match = text.match(/\{[^{}]*"mean"[^{}]*"median"[^{}]*"std"[^{}]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  const anyJson = text.match(/\{[^{}]*\}/g);
  if (anyJson) {
    for (const candidate of anyJson) {
      try {
        const obj = JSON.parse(candidate);
        if ("mean" in obj && "median" in obj && "std" in obj) return obj;
      } catch {}
    }
  }
  return null;
}
