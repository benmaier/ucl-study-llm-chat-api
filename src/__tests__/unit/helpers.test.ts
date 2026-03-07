import {
  inferMimeType,
  inferLanguage,
  mimeToExtension,
  extractCodeFromPartialJson,
  parseResponse,
} from "../../modules/helpers.js";

describe("inferMimeType", () => {
  it("maps csv to text/csv", () => {
    expect(inferMimeType("data.csv")).toBe("text/csv");
  });

  it("maps png to image/png", () => {
    expect(inferMimeType("chart.png")).toBe("image/png");
  });

  it("maps jpg to image/jpeg", () => {
    expect(inferMimeType("photo.jpg")).toBe("image/jpeg");
  });

  it("maps xlsx to correct MIME", () => {
    expect(inferMimeType("report.xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("defaults to application/octet-stream for unknown", () => {
    expect(inferMimeType("file.xyz")).toBe("application/octet-stream");
  });

  it("handles files without extension", () => {
    expect(inferMimeType("Makefile")).toBe("application/octet-stream");
  });

  it("is case-insensitive on extension", () => {
    expect(inferMimeType("image.PNG")).toBe("image/png");
  });
});

describe("inferLanguage", () => {
  it("maps .py to python", () => {
    expect(inferLanguage("script.py")).toBe("python");
  });

  it("maps .ts to typescript", () => {
    expect(inferLanguage("index.ts")).toBe("typescript");
  });

  it("maps .jl to julia", () => {
    expect(inferLanguage("sim.jl")).toBe("julia");
  });

  it("defaults to python for unknown", () => {
    expect(inferLanguage("file.xyz")).toBe("python");
  });

  it("handles paths with directories", () => {
    expect(inferLanguage("/home/user/code.js")).toBe("javascript");
  });
});

describe("mimeToExtension", () => {
  it("maps image/png to png", () => {
    expect(mimeToExtension("image/png")).toBe("png");
  });

  it("maps image/jpeg to jpg", () => {
    expect(mimeToExtension("image/jpeg")).toBe("jpg");
  });

  it("maps text/csv to csv", () => {
    expect(mimeToExtension("text/csv")).toBe("csv");
  });

  it("defaults to bin for unknown", () => {
    expect(mimeToExtension("application/x-custom")).toBe("bin");
  });
});

describe("extractCodeFromPartialJson", () => {
  it("extracts file_text value", () => {
    const json = '{"command":"create","path":"test.py","file_text":"print(1)"}';
    const result = extractCodeFromPartialJson(json, 0);
    expect(result.newCode).toBe("print(1)");
    expect(result.totalLength).toBe(8);
  });

  it("handles escaped newlines", () => {
    const json = '{"file_text":"line1\\nline2"}';
    const result = extractCodeFromPartialJson(json, 0);
    expect(result.newCode).toBe("line1\nline2");
  });

  it("handles escaped tabs", () => {
    const json = '{"file_text":"col1\\tcol2"}';
    const result = extractCodeFromPartialJson(json, 0);
    expect(result.newCode).toBe("col1\tcol2");
  });

  it("handles escaped quotes", () => {
    const json = '{"file_text":"say \\"hello\\""}';
    const result = extractCodeFromPartialJson(json, 0);
    expect(result.newCode).toBe('say "hello"');
  });

  it("handles escaped backslashes", () => {
    const json = '{"file_text":"path\\\\to\\\\file"}';
    const result = extractCodeFromPartialJson(json, 0);
    expect(result.newCode).toBe("path\\to\\file");
  });

  it("returns only delta since last extraction", () => {
    const json = '{"file_text":"abcdef"}';
    const result = extractCodeFromPartialJson(json, 3);
    expect(result.newCode).toBe("def");
    expect(result.totalLength).toBe(6);
  });

  it("handles incomplete JSON (no file_text yet)", () => {
    const json = '{"command":"create","path":"test.py"';
    const result = extractCodeFromPartialJson(json, 0);
    expect(result.newCode).toBe("");
    expect(result.totalLength).toBe(0);
  });

  it("handles partial file_text value (streaming)", () => {
    const json = '{"file_text":"import os\\nimpo';
    const result = extractCodeFromPartialJson(json, 0);
    expect(result.newCode).toBe("import os\nimpo");
  });
});

describe("parseResponse", () => {
  it("parses clean JSON", () => {
    const text = '{"mean": 0.5, "median": 0.48, "std": 0.29}';
    const result = parseResponse(text);
    expect(result).toEqual({ mean: 0.5, median: 0.48, std: 0.29 });
  });

  it("extracts JSON embedded in text", () => {
    const text = 'Here are the results:\n{"mean": 0.5, "median": 0.48, "std": 0.29}\nDone!';
    const result = parseResponse(text);
    expect(result).toEqual({ mean: 0.5, median: 0.48, std: 0.29 });
  });

  it("returns null for missing fields", () => {
    const text = '{"mean": 0.5, "median": 0.48}';
    expect(parseResponse(text)).toBeNull();
  });

  it("returns null for no JSON", () => {
    const text = "The mean is 0.5, the median is 0.48, and the std is 0.29.";
    expect(parseResponse(text)).toBeNull();
  });

  it("handles JSON with extra whitespace", () => {
    const text = '{ "mean": 0.123456, "median": 0.234567, "std": 0.345678 }';
    const result = parseResponse(text);
    expect(result).toEqual({ mean: 0.123456, median: 0.234567, std: 0.345678 });
  });
});
