export type MultipartFile = {
  name: string;
  filename: string | null;
  contentType: string | null;
  byteLength: number;
};

export type MultipartForm = {
  fields: Record<string, string>;
  files: Record<string, MultipartFile>;
};

export function parseMultipartForm(contentType: string | undefined, body: Buffer): MultipartForm {
  const boundary = readBoundary(contentType);
  const fields: Record<string, string> = {};
  const files: Record<string, MultipartFile> = {};
  for (const part of splitParts(body, boundary)) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      continue;
    }
    const headerText = part.subarray(0, headerEnd).toString("latin1");
    const content = trimTrailingCrlf(part.subarray(headerEnd + 4));
    const disposition = headerText.split("\r\n").find((line) => /^content-disposition:/i.test(line));
    const name = disposition ? readDispositionValue(disposition, "name") : null;
    if (!name) {
      continue;
    }
    const filename = disposition ? readDispositionValue(disposition, "filename") : null;
    const partContentType = headerText
      .split("\r\n")
      .find((line) => /^content-type:/i.test(line))
      ?.split(":")
      .slice(1)
      .join(":")
      .trim() ?? null;
    if (filename) {
      files[name] = {
        name,
        filename,
        contentType: partContentType,
        byteLength: content.length
      };
    } else {
      fields[name] = content.toString("utf8");
    }
  }
  return { fields, files };
}

function readBoundary(contentType: string | undefined): string {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) {
    throw Object.assign(new Error("multipart/form-data boundary is required"), {
      statusCode: 400,
      errorType: "invalid_request_error"
    });
  }
  return boundary;
}

function splitParts(body: Buffer, boundary: string): Buffer[] {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < body.length) {
    const start = body.indexOf(delimiter, offset);
    if (start < 0) {
      break;
    }
    const contentStart = start + delimiter.length;
    if (body.subarray(contentStart, contentStart + 2).toString("latin1") === "--") {
      break;
    }
    const partStart = body.subarray(contentStart, contentStart + 2).toString("latin1") === "\r\n"
      ? contentStart + 2
      : contentStart;
    const next = body.indexOf(delimiter, partStart);
    if (next < 0) {
      break;
    }
    parts.push(trimTrailingCrlf(body.subarray(partStart, next)));
    offset = next;
  }
  return parts;
}

function trimTrailingCrlf(value: Buffer): Buffer {
  if (value.length >= 2 && value.subarray(value.length - 2).toString("latin1") === "\r\n") {
    return value.subarray(0, value.length - 2);
  }
  return value;
}

function readDispositionValue(disposition: string, key: string): string | null {
  const match = new RegExp(`${key}="([^"]*)"`, "i").exec(disposition);
  return match?.[1] ?? null;
}
