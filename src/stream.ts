import { Transform } from "node:stream";

import { parseJsonlStream } from "./parse";

export class JsonlStream extends Transform {
  constructor() {
    let buffer = "";

    super({
      readableObjectMode: true,
      transform(chunk, encoding, callback) {
        buffer += chunk.toString();

        try {
          const result = parseJsonlStream(buffer, false);
          buffer = result.buffer;

          for (const item of result.items) {
            this.push(item);
          }
          callback();
        } catch (err: any) {
          callback(err);
        }
      },
      flush(callback) {
        try {
          if (buffer.trim() !== "") {
            const result = parseJsonlStream(buffer, true);
            for (const item of result.items) {
              this.push(item);
            }
          }
          callback();
        } catch (err: any) {
          callback(err);
        }
      }
    });
  }
}
