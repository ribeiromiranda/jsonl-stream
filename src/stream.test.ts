import { describe, it, expect, vi } from "vitest";
import { JsonlStream } from "./stream";
import { JsonParserError } from "./error";

describe("JsonlStream", () => {
  it("should have _transform and _flush methods", () => {
    const stream = new JsonlStream();
    expect(typeof stream._transform).toBe("function");
    expect(typeof stream._flush).toBe("function");
  });

  it("should push items on _transform if valid JSONL is provided", () => {
    const stream = new JsonlStream();
    const pushSpy = vi.spyOn(stream, "push");
    const callback = vi.fn();

    stream._transform(Buffer.from('{"id": 1}\n{"id": 2}\n'), "utf8", callback);

    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(pushSpy).toHaveBeenNthCalledWith(1, { id: 1 });
    expect(pushSpy).toHaveBeenNthCalledWith(2, { id: 2 });
    expect(callback).toHaveBeenCalledWith();
  });

  it("should buffer incomplete primitive and push it when flushed", () => {
    const stream = new JsonlStream();
    const pushSpy = vi.spyOn(stream, "push");
    const transformCallback = vi.fn();
    const flushCallback = vi.fn();

    stream._transform(Buffer.from('{"id": 1}\n'), "utf8", transformCallback);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith({ id: 1 });
    expect(transformCallback).toHaveBeenCalledWith();

    stream._transform(Buffer.from('123'), "utf8", transformCallback);
    expect(pushSpy).toHaveBeenCalledTimes(1); // 123 is buffered, not pushed yet
    expect(transformCallback).toHaveBeenCalledWith();

    stream._flush(flushCallback);
    expect(pushSpy).toHaveBeenCalledTimes(2);
    expect(pushSpy).toHaveBeenLastCalledWith(123);
    expect(flushCallback).toHaveBeenCalledWith();
  });

  it("should call callback with error on invalid JSON inside _transform", () => {
    const stream = new JsonlStream();
    const callback = vi.fn();
    const chunk = Buffer.from('{"id": 1, "invalid" 123\n');

    stream._transform(chunk, "utf8", callback);
    expect(callback).toHaveBeenCalled();
    const errorArg = callback.mock.calls[0][0];
    expect(errorArg).toBeInstanceOf(JsonParserError);
    expect(errorArg.message).toContain("JSONL parsing failed: Expected ':' after key");
    expect(errorArg.originalError).toBeInstanceOf(Error);
    expect(errorArg.originalError.message).toContain("Expected ':' after key");
    expect(errorArg.context).toEqual({
      chunkSize: chunk.length,
      bufferLength: chunk.length,
      buffer: chunk.toString("utf8"),
    });
  });

  it("should call callback with error on invalid JSON inside _flush", async () => {
    const stream = new JsonlStream();
    const transformCallback = vi.fn();
    const chunk = Buffer.from('{"id": 1, "invalid"');

    stream._transform(chunk, "utf8", transformCallback);

    const errorArg = await new Promise<any>((resolve) => {
      stream._flush((err) => {
        resolve(err);
      });
    });

    expect(errorArg).toBeInstanceOf(JsonParserError);
    expect(errorArg.message).toContain("JSONL parsing failed during flush: Invalid JSONL at end of stream");
    expect(errorArg.originalError).toBeInstanceOf(Error);
    expect(errorArg.context).toEqual({
      chunkSize: 0,
      bufferLength: chunk.length,
      buffer: chunk.toString("utf8"),
    });
  });

  it("should handle multi-byte characters split across chunk boundaries", () => {
    const stream = new JsonlStream();
    const pushSpy = vi.spyOn(stream, "push");
    const callback = vi.fn();

    // The emoji 🚀 is encoded in UTF-8 as 4 bytes: F0 9F 9A 80
    // We split it across two chunks:
    // Chunk 1: '{"msg": "' + first 2 bytes of 🚀 (F0 9F)
    // Chunk 2: remaining 2 bytes of 🚀 (9A 80) + '"}\n'
    const emojiBytes = Buffer.from("🚀");

    const part1 = Buffer.concat([
      Buffer.from('{"msg": "'),
      emojiBytes.subarray(0, 2)
    ]);
    const part2 = Buffer.concat([
      emojiBytes.subarray(2),
      Buffer.from('"}\n')
    ]);

    stream._transform(part1, "utf8", callback);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith();

    stream._transform(part2, "utf8", callback);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith({ msg: "🚀" });
  });

  it("should enforce newline delimitations across chunks", () => {
    const stream = new JsonlStream();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    // Chunk 1 has a valid object: '{"id": 1}'
    stream._transform(Buffer.from('{"id": 1}'), "utf8", callback1);
    expect(callback1).toHaveBeenCalledWith();

    // Chunk 2 has another object on the same line: '{"id": 2}' (no leading newline)
    stream._transform(Buffer.from('{"id": 2}'), "utf8", callback2);
    expect(callback2).toHaveBeenCalled();
    const errorArg = callback2.mock.calls[0][0];
    expect(errorArg).toBeInstanceOf(JsonParserError);
    expect(errorArg.message).toContain("Multiple JSON records on the same line are not allowed");
  });

  it("should succeed when newline is split or placed correctly between chunks", () => {
    const stream = new JsonlStream();
    const pushSpy = vi.spyOn(stream, "push");
    const callback = vi.fn();

    // Chunk 1: '{"id": 1}'
    stream._transform(Buffer.from('{"id": 1}'), "utf8", callback);
    expect(pushSpy).toHaveBeenCalledWith({ id: 1 });

    // Chunk 2: '\n{"id": 2}' (has leading newline)
    stream._transform(Buffer.from('\n{"id": 2}'), "utf8", callback);
    expect(pushSpy).toHaveBeenCalledWith({ id: 2 });
  });

  it("should respect backpressure and wait for drain/read before calling transform callback", async () => {
    const stream = new JsonlStream();
    const readableState = (stream as any)._readableState;
    if (readableState) {
      readableState.highWaterMark = 1;
    }

    const callback = vi.fn();

    // We transform a chunk with multiple items. Because highWaterMark = 1,
    // the second push will return false (backpressure).
    stream._transform(Buffer.from('{"id": 1}\n{"id": 2}\n'), "utf8", callback);

    // Callback should NOT have been called synchronously because the queue is not fully processed.
    expect(callback).not.toHaveBeenCalled();

    // Simulating consumer reading from the stream
    stream.read(); // reads {"id": 1}

    // Wait a tick for stream state propagation
    await new Promise((resolve) => process.nextTick(resolve));

    // The queue should now have processed the second item and called the callback
    expect(callback).toHaveBeenCalled();
  });

  it("should propagate flush errors asynchronously", async () => {
    const stream = new JsonlStream();
    const transformCallback = vi.fn();
    const chunk = Buffer.from('{"id": 1, "invalid"');

    stream._transform(chunk, "utf8", transformCallback);

    let isCallbackAsync = false;
    const flushPromise = new Promise<any>((resolve) => {
      stream._flush((err) => {
        isCallbackAsync = true;
        resolve(err);
      });
    });

    // Callback should NOT be called synchronously
    expect(isCallbackAsync).toBe(false);

    const errorArg = await flushPromise;
    expect(isCallbackAsync).toBe(true);
    expect(errorArg).toBeInstanceOf(JsonParserError);
  });

  it("should support generics and provide type safety", async () => {
    interface User {
      id: number;
      name: string;
    }

    const stream = new JsonlStream<User>();
    const items: User[] = [];

    stream.on("data", (item: User) => {
      items.push(item);
    });

    await new Promise<void>((resolve, reject) => {
      stream.on("end", resolve);
      stream.on("error", reject);
      stream.write(Buffer.from('{"id": 1, "name": "Alice"}\n{"id": 2, "name": "Bob"}'));
      stream.end();
    });

    expect(items).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
  });
});
