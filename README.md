# jsonl-stream

[![npm version](https://img.shields.io/npm/v/jsonl-stream.svg?style=flat-square)](https://www.npmjs.com/package/jsonl-stream)
[![npm downloads](https://img.shields.io/npm/dm/jsonl-stream.svg?style=flat-square)](https://www.npmjs.com/package/jsonl-stream)
[![bundle size](https://img.shields.io/bundlephobia/minzip/jsonl-stream?style=flat-square)](https://bundlephobia.com/package/jsonl-stream)
[![license](https://img.shields.io/npm/l/jsonl-stream.svg?style=flat-square)](LICENSE)

A library for progressive parsing of **JSON Lines (JSONL)** — also known as **NDJSON** (Newline Delimited JSON) streams.

Specifically designed to process real-time data streams, such as AI model responses (LLM streaming like GPT/Gemini), massive log files, or any stream-based communication where network packets (chunks) arrive fragmented and incomplete over **HTTP/HTTPS**, **WebSockets**, **gRPC**, or local file system reads.

---

## Key Features

- **Smart Parsing**: Uses an internal character-by-character decoder that detects incomplete structures and buffers them until the next chunk arrives.
- **Complex Structures**: Supports nested objects, complex arrays, strings with unicode escape characters (`\uXXXX`), booleans, `null`, and numbers in various notations (including scientific notation like `-123.45e2`).
- **Stream API Compatibility**: Exposes a `JsonlStream` class extending the native Node.js `Transform` class, integrating seamlessly with pipes and streams in object mode (`readableObjectMode: true`). Ideal for HTTP requests and other streaming protocols.
- **Support for Diverse Line Endings**: Works correctly with Windows (`\r\n`), Unix/modern macOS (`\n`), and classic macOS (`\r`) line endings, handling extra whitespaces, tabs, and indentation gracefully.
- **Robust End-Of-File (EOF) Handling**: Allows explicitly indicating when the stream has ended (`isEnd = true`), forcing the parsing of remaining buffered numbers or primitive values.

---

## Installation

```bash
npm install jsonl-stream
```

---

## How to Use

The library is designed to be flexible. It works with the Node.js Stream API or by manually feeding chunks from persistent connections like WebSockets, gRPC, or Server-Sent Events (SSE).

### 1. Consuming data via HTTP Stream

Ideal for consuming APIs that send real-time data over HTTP/HTTPS.

#### Using `fetch` (Node.js 18+)

```typescript
import { Readable } from "node:stream";
import { JsonlStream } from "jsonl-stream";

async function consumeFetchStream() {
  const response = await fetch("https://api.example.com/stream");

  // Converts fetch's ReadableStream to a Node.js Readable stream
  const readableStream = Readable.fromWeb(response.body as any);
  const jsonlParser = new JsonlStream();

  readableStream.pipe(jsonlParser);

  try {
    for await (const item of jsonlParser) {
      console.log("Token or object received via HTTP:", item);
    }
    console.log("HTTP Stream finished!");
  } catch (error) {
    console.error("Error consuming the stream:", error);
  }
}

consumeFetchStream();
```

#### Using the `https` module

```typescript
import https from "node:https";
import { JsonlStream } from "jsonl-stream";

https.get("https://api.example.com/stream-jsonl", async (response) => {
  const jsonlParser = new JsonlStream();
  response.pipe(jsonlParser);

  try {
    for await (const item of jsonlParser) {
      console.log("JSON object received via HTTPS:", item);
    }
    console.log("HTTPS Stream successfully processed!");
  } catch (error) {
    console.error("Error in stream pipeline:", error);
  }
});
```

### 2. Reading Local Files via Stream

Ideal for processing extremely large JSONL files without exceeding memory limits.

```typescript
import { createReadStream } from "node:fs";
import { JsonlStream } from "jsonl-stream";

async function processFile() {
  const fileStream = createReadStream("data.jsonl");
  const jsonlParser = new JsonlStream();

  fileStream.pipe(jsonlParser);

  try {
    for await (const item of jsonlParser) {
      console.log("Object read from file:", item);
    }
    console.log("Local file fully processed!");
  } catch (error) {
    console.error("Error processing file:", error);
  }
}

processFile();
```

---

## 🧪 Development and Testing

If you are developing or testing the library locally, use the following npm commands:

### Build

Compiles TypeScript code, generating CJS, ESM bundles, and type definitions in the `dist/` folder:

```bash
npm run build
```

### Tests

Runs the full test suite using `Vitest`:

```bash
npm test
```

---

## Issues & Feedback

If you encounter any bugs, have questions, or would like to request a new feature, please feel free to [open an issue](https://github.com/ribeiromiranda/jsonl-stream/issues) on GitHub. Your feedback and contributions are highly welcome!

---

## License

This project is licensed under the **MIT** License. See the [LICENSE](LICENSE) file for details.
