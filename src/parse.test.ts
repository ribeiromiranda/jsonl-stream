import { describe, it, expect } from "vitest";
import { parseJsonlStream } from "./parse";
import { JsonParserError } from "./error";

describe("parse", () => {

  it("complex lines", async () => {
    let result = parseJsonlStream("{}");
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({});
    expect(result.remaining).toEqual("");

    const macData = "{\r\"name\":\r\"Mac formatting\",\r\"values\":\r[\r1,\r2,\r3\r]\r}";
    result = parseJsonlStream(macData);
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({
      name: "Mac formatting",
      values: [1, 2, 3]
    });

    const winData = "{\r\n\t\"name\":\t\"Windows formatting\",\r\n\t\"nested\": {\r\n\t\t\"prop\": null\r\n\t}\r\n}";
    result = parseJsonlStream(winData);
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({
      name: "Windows formatting",
      nested: { prop: null }
    });

    const complexFormatting = `
      {
        \r\n\t"system": "generic",
        \n\t"features": [
          "escaped\\nnewline",
          "escaped\\t\\r\\b\\f",
          "escaped\\u0041\\u0042"
        ],
        \r"data": {
          "active": true,
          "count": -123.45e2,
          "empty": null
        }\n
      }
    `;
    result = parseJsonlStream(complexFormatting);
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({
      system: "generic",
      features: [
        "escaped\nnewline",
        "escaped\t\r\b\f",
        "escapedAB"
      ],
      data: {
        active: true,
        count: -123.45e2,
        empty: null
      }
    });

    const allTypesData = JSON.stringify({
      string: "hello world",
      number: 42.5,
      integer: -100,
      booleanTrue: true,
      booleanFalse: false,
      nullValue: null,
      array: [
        1,
        "two",
        false,
        null,
        { nestedObject: true }
      ],
      object: {
        nestedString: "nested",
        nestedArray: [1, 2, 3]
      }
    });
    result = parseJsonlStream(allTypesData);
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({
      string: "hello world",
      number: 42.5,
      integer: -100,
      booleanTrue: true,
      booleanFalse: false,
      nullValue: null,
      array: [
        1,
        "two",
        false,
        null,
        { nestedObject: true }
      ],
      object: {
        nestedString: "nested",
        nestedArray: [1, 2, 3]
      }
    });
  });

  it("lines with breakline", async () => {
    let result = parseJsonlStream("{}\n");
    expect(1).toEqual(result.items.length);
    expect({}).toEqual(result.items[0]);
    expect("").toEqual(result.remaining);

    result = parseJsonlStream("{}\n{}\n");
    expect(2).toEqual(result.items.length);
    expect(result.items[0]).toEqual({});
    expect(result.items[1]).toEqual({});
    expect(result.remaining).toEqual("");

    result = parseJsonlStream("\n{}\n{}\n");
    expect(2).toEqual(result.items.length);
    expect(result.items[0]).toEqual({});
    expect(result.items[1]).toEqual({});
    expect(result.remaining).toEqual("");
  });

  it("lines multiple keys", async () => {
    const result = parseJsonlStream("{\"test\": {}}\n{\"test\": [{}]}\n");
    expect(result.items.length).toEqual(2);
    expect(result.items[0]).toEqual({ "test": {} });
    expect(result.items[1]).toEqual({ "test": [{}] });
    expect(result.remaining).toEqual("");
  });

  it("multiple objects in the same stream", async () => {
    // Multiple objects in a single chunk separated by newline
    const data = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Charlie"}';
    let result = parseJsonlStream(data);
    expect(result.items.length).toEqual(3); // Since the last object is complete, it is parsed
    expect(result.items[0]).toEqual({ id: 1, name: "Alice" });
    expect(result.items[1]).toEqual({ id: 2, name: "Bob" });
    expect(result.items[2]).toEqual({ id: 3, name: "Charlie" });
    expect(result.remaining).toEqual("");

    // Multiple objects in a single chunk separated by newline where the last one is INCOMPLETE
    const dataWithIncomplete = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":';
    result = parseJsonlStream(dataWithIncomplete);
    expect(result.items.length).toEqual(2);
    expect(result.items[0]).toEqual({ id: 1, name: "Alice" });
    expect(result.items[1]).toEqual({ id: 2, name: "Bob" });
    expect(result.remaining).toEqual('{"id":3,"name":');

    // Parse the rest with EOF
    result = parseJsonlStream(result.remaining + '"Charlie"}', true);
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({ id: 3, name: "Charlie" });
    expect(result.remaining).toEqual("");

    // Multiple objects with whitespace and different formatting
    const data2 = '{"a": 1}\n\n  \n{"b": 2}\r\n{"c": 3}\n';
    result = parseJsonlStream(data2);
    expect(result.items).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(result.remaining).toEqual("");
  });

  it("lines partial", async () => {
    let result = parseJsonlStream("{\"test\": {");
    expect(result.items.length).toEqual(0);
    expect(result.remaining).toEqual("{\"test\": {");

    result = parseJsonlStream("{\"test\": {\"te");
    expect(result.items.length).toEqual(0);
    expect(result.remaining).toEqual("{\"test\": {\"te");

    result = parseJsonlStream("{\"test\": {}}\n{\"test\": [{}");
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({ "test": {} });
    expect(result.remaining).toEqual("{\"test\": [{}");

    result = parseJsonlStream(result.remaining + "]}");
    expect(1).toEqual(result.items.length);
    expect(result.items[0]).toEqual({ "test": [{}] });
    expect(result.remaining).toEqual("");
  });

  it("lines error", async () => {
    try {
      parseJsonlStream("{\"test\": {\"test\":1 \"tes");
    } catch (e: any) {
      expect(e.message).toContain("Expected ',' in object");
    }
  });

  it("primitives support", async () => {
    let result = parseJsonlStream('123\n"test"\ntrue\nfalse\nnull\n');
    expect(result.items).toEqual([123, "test", true, false, null]);

    // EOF behavior without isEnd
    result = parseJsonlStream('123');
    expect(result.items.length).toEqual(0); // incomplete number
    expect(result.remaining).toEqual('123');

    // EOF behavior with isEnd
    result = parseJsonlStream('123', true);
    expect(result.items).toEqual([123]);
    expect(result.remaining).toEqual('');
  });

  it("strict RFC 8259 number validation", () => {
    // 1. Unary `+` at the start of a token (e.g. +1):
    expect(() => parseJsonlStream("+1", true)).toThrow("Unexpected token '+'");

    // 2. Trailing dot `1.`:
    expect(() => parseJsonlStream("1.", true)).toThrow("Invalid number format '1.'");

    // 3. Leading zero `01`:
    expect(() => parseJsonlStream("01", true)).toThrow("Invalid number format '01'");

    // 4. Multiple signs like `--1`:
    expect(() => parseJsonlStream("--1", true)).toThrow("Invalid number format '-'");

    // 5. Incomplete exponent (e.g. 1e, 1e+, 1e-):
    expect(() => parseJsonlStream("1e", true)).toThrow("Invalid number format '1e'");
    expect(() => parseJsonlStream("1e+", true)).toThrow("Invalid number format '1e+'");
    expect(() => parseJsonlStream("1e-", true)).toThrow("Invalid number format '1e-'");

    // 6. Dot followed by non-digits (e.g. 1.e2, 1..2):
    expect(() => parseJsonlStream("1..2", true)).toThrow("Invalid number format '1.'");

    // 7. Non-digits after sign in exponent (e.g. 1e+a):
    expect(() => parseJsonlStream("1e+a", true)).toThrow("Invalid number format");
  });

  it("immediate syntax/validation error on '+' sign mismatch", () => {
    // A '+' sign cannot follow a digit directly. It should fail immediately rather than throwing IncompleteError
    expect(() => parseJsonlStream("123+", false)).toThrow("Multiple JSON records on the same line are not allowed");
    expect(() => parseJsonlStream("123\n+", false)).toThrow("Unexpected token '+'");
    expect(() => parseJsonlStream("123-", false)).toThrow("Multiple JSON records on the same line are not allowed");

    // A '-' at the start of a line/value is valid, so it should be treated as incomplete when streaming (isEnd = false)
    const res = parseJsonlStream("123\n-", false);
    expect(res.items).toEqual([123]);
    expect(res.remaining).toEqual("-");

    // But if the stream ends, it is invalid
    expect(() => parseJsonlStream("123\n-", true)).toThrow("Invalid number format '-'");
  });

  it("should enforce newline record boundaries and disallow multiple records on the same line", () => {
    // 1. Multiple objects on the same line (separated by space/tabs or nothing) should fail:
    expect(() => parseJsonlStream('{"id": 1}{"id": 2}', true)).toThrow(
      "Multiple JSON records on the same line are not allowed"
    );
    expect(() => parseJsonlStream('{"id": 1}   {"id": 2}', true)).toThrow(
      "Multiple JSON records on the same line are not allowed"
    );
    expect(() => parseJsonlStream('123 456', true)).toThrow(
      "Multiple JSON records on the same line are not allowed"
    );

    // 2. Objects separated by newline should succeed:
    const res = parseJsonlStream('{"id": 1}\n{"id": 2}\r\n{"id": 3}', true);
    expect(res.items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);

    // 3. Multiline objects (pretty printed) should still succeed because the newlines are inside the object definition:
    const res2 = parseJsonlStream('{\n  "id": 1\n}\n{\n  "id": 2\n}', true);
    expect(res2.items).toEqual([{ id: 1 }, { id: 2 }]);

    // 4. Object with string containing escaped newlines should succeed:
    const res3 = parseJsonlStream('{"msg": "hello\\nworld"}\n{"msg": "test"}', true);
    expect(res3.items).toEqual([{ msg: "hello\nworld" }, { msg: "test" }]);

    // 5. Test state persistence parameter:
    const step1 = parseJsonlStream('{"id": 1}', false, true);
    expect(step1.items).toEqual([{ id: 1 }]);
    expect(step1.hasNewlineSinceLastItem).toBe(false);

    // If we call parseJsonlStream on a new chunk without a leading newline, it should fail if hasNewlineSinceLastItem is false:
    expect(() => parseJsonlStream('{"id": 2}', true, step1.hasNewlineSinceLastItem)).toThrow(
      "Multiple JSON records on the same line are not allowed"
    );

    // If it has a leading newline, it should succeed:
    const step2 = parseJsonlStream('\n{"id": 2}', true, step1.hasNewlineSinceLastItem);
    expect(step2.items).toEqual([{ id: 2 }]);
    expect(step2.hasNewlineSinceLastItem).toBe(false);
  });

  it("strict RFC 8259 string escaping and unicode validation", () => {
    // 1. Raw control characters (U+0000 to U+001F) inside string:
    expect(() => parseJsonlStream('"\n"', true)).toThrow("Unescaped control character U+000a");
    expect(() => parseJsonlStream('"\r"', true)).toThrow("Unescaped control character U+000d");
    expect(() => parseJsonlStream('"\t"', true)).toThrow("Unescaped control character U+0009");
    expect(() => parseJsonlStream('"\u0000"', true)).toThrow("Unescaped control character U+0000");
    expect(() => parseJsonlStream('"\u001f"', true)).toThrow("Unescaped control character U+001f");

    // 2. Valid escaped control characters should still succeed:
    expect(parseJsonlStream('"\\n"', true).items).toEqual(["\n"]);
    expect(parseJsonlStream('"\\r"', true).items).toEqual(["\r"]);
    expect(parseJsonlStream('"\\t"', true).items).toEqual(["\t"]);
    expect(parseJsonlStream('"\\u0000"', true).items).toEqual(["\0"]);

    // 3. Invalid unicode escape sequence (non-hex chars):
    expect(() => parseJsonlStream('"\\u004G"', true)).toThrow("Invalid Unicode escape sequence \\u004G");
    expect(() => parseJsonlStream('"\\u004Gabc"', true)).toThrow("Invalid Unicode escape sequence \\u004G");
    expect(() => parseJsonlStream('"\\u004\""', true)).toThrow("Invalid Unicode escape sequence \\u004\"");

    // 4. Correctly parse valid unicode escape sequences and check that trailing characters are NOT skipped:
    expect(parseJsonlStream('"\\u0041"', true).items).toEqual(["A"]);
    expect(parseJsonlStream('"\\u0041b"', true).items).toEqual(["Ab"]);
    expect(parseJsonlStream('"\\u0041\\u0042"', true).items).toEqual(["AB"]);
    expect(parseJsonlStream('"\\u0041\\u0042c"', true).items).toEqual(["ABc"]);
    expect(parseJsonlStream('"\\u0041🌟"', true).items).toEqual(["A🌟"]);
  });

  it("generics support and type safety", () => {
    interface User {
      id: number;
      name: string;
    }

    const data = '{"id": 1, "name": "Alice"}';
    const result = parseJsonlStream<User>(data, true);

    const firstItem: User = result.items[0];
    expect(firstItem.id).toBe(1);
    expect(firstItem.name).toBe("Alice");
    expect(result.remaining).toBe("");
  });

  it("should throw JsonParserError with originalError and context details on syntax error", () => {
    const data = '{"id": 1, "invalid" 123';
    try {
      parseJsonlStream(data, true);
      expect.fail("Expected parseJsonlStream to throw an error");
    } catch (err: any) {
      expect(err).toBeInstanceOf(JsonParserError);
      expect(err.message).toContain("JSONL parsing failed: Expected ':' after key");
      expect(err.originalError).toBeInstanceOf(Error);
      expect(err.originalError.message).toContain("Expected ':' after key");
      expect(err.context).toEqual({
        bufferLength: data.length,
        buffer: data,
      });
    }
  });
});

