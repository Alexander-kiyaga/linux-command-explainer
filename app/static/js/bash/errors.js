export class BashError extends Error {
  constructor(kind, message, line = 1, column = 1) {
    super(message);
    this.name = "BashError";
    this.kind = kind;
    this.line = line;
    this.column = column;
  }
}

export function bashError(kind, message, position) {
  throw new BashError(kind, message, position?.line ?? 1, position?.column ?? 1);
}

export function describeError(error) {
  return `Line ${error.line}, column ${error.column}: ${error.message}`;
}
