export class SimError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = "SimError";
    this.exitCode = exitCode;
  }
}

export function fail(message, exitCode = 1) {
  throw new SimError(message, exitCode);
}
