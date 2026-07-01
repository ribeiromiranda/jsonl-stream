// Light, stackless signaling mechanism for stream chunk continuation.
// Since it is used strictly for internal control flow, it does not extend Error.
export class IncompleteError {
  public readonly name = "IncompleteError";
}

// Custom error indicating a JSONL parsing failure.
// Encapsulates the original syntax or validation error and captures the parsing context.
export class JsonParserError extends Error {
  // The underlying error that triggered the failure.
  public readonly originalError: Error;
  // Stream buffer state and chunk size at the moment of parsing failure.
  public readonly context: {
    chunkSize?: number;
    bufferLength: number;
    buffer: string;
  };

  constructor(
    message: string,
    originalError: Error,
    context: { chunkSize?: number; bufferLength: number; buffer: string }
  ) {
    // Utilize modern Error cause (ES2022) to link the error chain natively.
    super(message, { cause: originalError });
    this.name = "JsonParserError";
    this.originalError = originalError;
    this.context = context;

    // Maintains proper stack trace in V8 environments.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, JsonParserError);
    }
  }
}
