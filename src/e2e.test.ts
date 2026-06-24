import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { Readable } from "node:stream";
import { createReadStream, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { JsonlStream } from "./stream";

describe("E2E Integration Tests (README Examples)", () => {
  let server: http.Server;
  let serverUrl: string;

  beforeAll(() => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });

      // Write fragmented JSONL data with delays to simulate real-world streaming
      res.write('{"id":1,"name":"Al');
      setTimeout(() => {
        res.write('ice"}\n{"id":2,"name":"Bob"}\n{"id"');
        setTimeout(() => {
          res.write(':3,"name":"Charlie"}\n');
          res.end();
        }, 30);
      }, 30);
    });

    return new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as any;
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("E2E Example 1: Consuming data via HTTP Stream using fetch and Readable.fromWeb", async () => {
    const response = await fetch(serverUrl);
    expect(response.body).toBeDefined();

    // Converts fetch's ReadableStream to a Node.js Readable stream
    const readableStream = Readable.fromWeb(response.body as any);
    const jsonlParser = new JsonlStream();

    readableStream.pipe(jsonlParser);

    const items: any[] = [];
    try {
      for await (const item of jsonlParser) {
        items.push(item);
      }
    } catch (error) {
      console.error("Error consuming the stream:", error);
      throw error;
    }

    expect(items).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" }
    ]);
  });

  it("E2E Example 2: Consuming data via HTTP Stream using http.get module", async () => {
    const items: any[] = [];

    await new Promise<void>((resolve, reject) => {
      http.get(serverUrl, async (response) => {
        const jsonlParser = new JsonlStream();
        response.pipe(jsonlParser);

        try {
          for await (const item of jsonlParser) {
            items.push(item);
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      }).on("error", (err) => {
        reject(err);
      });
    });

    expect(items).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
      { id: 3, name: "Charlie" }
    ]);
  });

  it("E2E Example 3: Reading Local Files via Stream", async () => {
    const tempFilePath = join(__dirname, "temp_data.jsonl");
    const testData = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Charlie"}\n';
    writeFileSync(tempFilePath, testData, "utf8");

    try {
      const fileStream = createReadStream(tempFilePath);
      const jsonlParser = new JsonlStream();

      fileStream.pipe(jsonlParser);

      const items: any[] = [];
      for await (const item of jsonlParser) {
        items.push(item);
      }

      expect(items).toEqual([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" }
      ]);
    } finally {
      try {
        unlinkSync(tempFilePath);
      } catch (e) {
        // ignore
      }
    }
  });

  it("E2E: Should correctly stream primitives and handle end-of-file buffer flushing", async () => {
    const stream = new Readable({
      read() {
        this.push('123\n"test"\n');
        this.push('true\nfalse\n');
        this.push('456'); // No trailing newline, rely on stream flush/end
        this.push(null);
      }
    });

    const jsonlParser = new JsonlStream();
    stream.pipe(jsonlParser);

    const items: any[] = [];
    for await (const item of jsonlParser) {
      items.push(item);
    }

    expect(items).toEqual([123, "test", true, false, 456]);
  });

  it("E2E: Should correctly propagate stream error on invalid JSON", async () => {
    let pushed = false;
    const stream = new Readable({
      read() {
        if (pushed) return;
        pushed = true;
        this.push('{"id": 1}\n');
        setImmediate(() => {
          this.push('{"id": 2, "key" 123\n');
          this.push(null);
        });
      }
    });

    const jsonlParser = new JsonlStream();
    stream.pipe(jsonlParser);

    const items: any[] = [];
    let errorOccurred = false;

    try {
      for await (const item of jsonlParser) {
        items.push(item);
      }
    } catch (err: any) {
      errorOccurred = true;
      expect(err.message).toContain("Expected ':' after key in object");
    }

    expect(errorOccurred).toBe(true);
    expect(items).toEqual([{ id: 1 }]);
  });

  it("E2E: Should parse files/streams with various line endings (LF, CRLF, CR)", async () => {
    const stream = new Readable({
      read() {
        this.push('{"line": 1}\n'); // LF
        this.push('{"line": 2}\r\n'); // CRLF
        this.push('{"line": 3}\r'); // CR
        this.push('{"line": 4}'); // EOF flush
        this.push(null);
      }
    });

    const jsonlParser = new JsonlStream();
    stream.pipe(jsonlParser);

    const items: any[] = [];
    for await (const item of jsonlParser) {
      items.push(item);
    }

    expect(items).toEqual([
      { line: 1 },
      { line: 2 },
      { line: 3 },
      { line: 4 }
    ]);
  });

  it("E2E: Should handle empty streams and whitespace-only streams gracefully", async () => {
    const stream = new Readable({
      read() {
        this.push('   \n\n  \r\n ');
        this.push(null);
      }
    });

    const jsonlParser = new JsonlStream();
    stream.pipe(jsonlParser);

    const items: any[] = [];
    for await (const item of jsonlParser) {
      items.push(item);
    }

    expect(items).toEqual([]);
  });
});
