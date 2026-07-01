import { Transform, TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";

import { parseJsonlStream } from "./parse";
import { JsonParserError } from "./error";


// A transform stream that parses input chunks as newline-delimited JSON (JSONL).
export class JsonlStream<T> extends Transform {
  // Accumulates partial string data across incoming chunks.
  private buffer = "";
  // Handles multi-byte UTF-8 character boundaries across chunk transitions.
  private decoder: StringDecoder;
  // Tracks whether a newline was observed since the last parsed item to enforce record boundaries.
  private hasNewlineSinceLastItem = true;
  // Temporary storage for parsed items to handle backpressure and downstream flow control.
  private pushQueue: T[] = [];
  // Deferred callback for the current write/flush operation, invoked once the queue is fully drained.
  private pendingCallback: TransformCallback | null = null;

  constructor() {
    // Configure stream to output parsed objects and decode write buffers to strings.
    super({
      readableObjectMode: true,
      decodeStrings: true,
    });
    this.decoder = new StringDecoder("utf8");
  }

  // Triggered when the downstream consumer requests more data.
  _read(size: number): void {
    this._processQueue();
    // If the queue has been fully drained, resume reading from the upstream source.
    if (this.pushQueue.length === 0) {
      super._read(size);
    }
  }

  // Flushes the internal queue downstream while adhering to stream backpressure.
  private _processQueue(): void {
    while (this.pushQueue.length > 0) {
      const item = this.pushQueue[0];
      const canPush = this.push(item);
      if (canPush) {
        this.pushQueue.shift();
      } else {
        // Shift the item because it was successfully queued in Node's internal buffer,
        // then halt processing to respect backpressure.
        this.pushQueue.shift();
        break;
      }
    }

    // Invoke the deferred callback once all parsed items are processed, resuming upstream writes.
    if (this.pushQueue.length === 0 && this.pendingCallback) {
      const callback = this.pendingCallback;
      this.pendingCallback = null;
      callback();
    }
  }

  // Processes incoming binary chunks, decodes them to UTF-8, and parses complete JSONL lines.
  _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    // Decode binary chunk to UTF-8 string. StringDecoder.write does not throw exceptions.
    const decoded = this.decoder.write(chunk);
    this.buffer += decoded;

    try {
      // Parse all complete JSON records currently available in the buffer.
      const result = parseJsonlStream<T>(this.buffer, false, this.hasNewlineSinceLastItem);
      this.buffer = result.remaining;
      this.hasNewlineSinceLastItem = result.hasNewlineSinceLastItem;

      for (const item of result.items) {
        this.pushQueue.push(item);
      }
      // Store the write callback and process the queue, yielding execution back to Node.js streams.
      this.pendingCallback = callback;
      this._processQueue();
    } catch (err: unknown) {
      if (err instanceof JsonParserError) {
        // Propagate the parse error with an immutable copy containing the chunkSize.
        callback(
          new JsonParserError(err.message, err.originalError, {
            ...err.context,
            chunkSize: chunk ? chunk.length : 0,
          })
        );
      } else {
        const originalError = err instanceof Error ? err : new Error(String(err));
        callback(
          new JsonParserError(
            `JSONL parsing failed: ${originalError.message}`,
            originalError,
            {
              chunkSize: chunk ? chunk.length : 0,
              bufferLength: this.buffer.length,
              buffer: this.buffer,
            }
          )
        );
      }
    }
  }

  // Invoked when the upstream writable side finishes, processing any remaining buffered data.
  _flush(callback: TransformCallback): void {
    // Retrieve any trailing bytes left in the decoder. StringDecoder.end does not throw exceptions.
    const remainingDecoded = this.decoder.end();
    this.buffer += remainingDecoded;

    // Parse the final remaining content if it contains non-whitespace characters.
    if (this.buffer.trim() !== "") {
      try {
        const result = parseJsonlStream<T>(this.buffer, true, this.hasNewlineSinceLastItem);
        this.hasNewlineSinceLastItem = result.hasNewlineSinceLastItem;
        for (const item of result.items) {
          this.pushQueue.push(item);
        }

        // Throw an error if non-whitespace trailing data remains incomplete at EOF.
        if (result.remaining.trim() !== "") {
          throw new Error(`Invalid JSONL at end of stream: incomplete structure "${result.remaining}"`);
        }
      } catch (err: unknown) {
        let parseError: JsonParserError;
        if (err instanceof JsonParserError) {
          parseError = new JsonParserError(
            `JSONL parsing failed during flush: ${err.originalError.message}`,
            err.originalError,
            { ...err.context, chunkSize: 0 }
          );
        } else {
          const originalError = err instanceof Error ? err : new Error(String(err));
          parseError = new JsonParserError(
            `JSONL parsing failed during flush: ${originalError.message}`,
            originalError,
            {
              chunkSize: 0,
              bufferLength: this.buffer.length,
              buffer: this.buffer,
            }
          );
        }
        // Defer error emission to next tick to align with stream error-propagation expectations.
        process.nextTick(() => callback(parseError));
        return;
      }
    }
    // Store the flush callback and drain the remaining queue before finishing.
    this.pendingCallback = callback;
    this._processQueue();
  }
}
