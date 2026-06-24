import { describe, it, expect } from "vitest";
import { parseJsonlStream } from "./parse";

describe("parse", () => {

  it("complex lines", async () => {
    let result = parseJsonlStream("{}");
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({});
    expect(result.buffer).toEqual("");

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
    expect("").toEqual(result.buffer);

    result = parseJsonlStream("{}\n{}\n");
    expect(2).toEqual(result.items.length);
    expect(result.items[0]).toEqual({});
    expect(result.items[1]).toEqual({});
    expect(result.buffer).toEqual("");

    result = parseJsonlStream("\n{}\n{}\n");
    expect(2).toEqual(result.items.length);
    expect(result.items[0]).toEqual({});
    expect(result.items[1]).toEqual({});
    expect(result.buffer).toEqual("");
  });

  it("lines multiple keys", async () => {
    const result = parseJsonlStream("{\"test\": {}}\n{\"test\": [{}]}\n");
    expect(result.items.length).toEqual(2);
    expect(result.items[0]).toEqual({ "test": {} });
    expect(result.items[1]).toEqual({ "test": [{}] });
    expect(result.buffer).toEqual("");
  });

  it("multiple objects in the same stream", async () => {
    // Multiple objects in a single chunk separated by newline
    const data = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":"Charlie"}';
    let result = parseJsonlStream(data);
    expect(result.items.length).toEqual(3); // Since the last object is complete, it is parsed
    expect(result.items[0]).toEqual({ id: 1, name: "Alice" });
    expect(result.items[1]).toEqual({ id: 2, name: "Bob" });
    expect(result.items[2]).toEqual({ id: 3, name: "Charlie" });
    expect(result.buffer).toEqual("");

    // Multiple objects in a single chunk separated by newline where the last one is INCOMPLETE
    const dataWithIncomplete = '{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n{"id":3,"name":';
    result = parseJsonlStream(dataWithIncomplete);
    expect(result.items.length).toEqual(2);
    expect(result.items[0]).toEqual({ id: 1, name: "Alice" });
    expect(result.items[1]).toEqual({ id: 2, name: "Bob" });
    expect(result.buffer).toEqual('{"id":3,"name":');

    // Parse the rest with EOF
    result = parseJsonlStream(result.buffer + '"Charlie"}', true);
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({ id: 3, name: "Charlie" });
    expect(result.buffer).toEqual("");

    // Multiple objects with whitespace and different formatting
    const data2 = '{"a": 1}\n\n  \n{"b": 2}\r\n{"c": 3}\n';
    result = parseJsonlStream(data2);
    expect(result.items).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(result.buffer).toEqual("");
  });

  it("lines partial", async () => {
    let result = parseJsonlStream("{\"test\": {");
    expect(result.items.length).toEqual(0);
    expect(result.buffer).toEqual("{\"test\": {");

    result = parseJsonlStream("{\"test\": {\"te");
    expect(result.items.length).toEqual(0);
    expect(result.buffer).toEqual("{\"test\": {\"te");

    result = parseJsonlStream("{\"test\": {}}\n{\"test\": [{}");
    expect(result.items.length).toEqual(1);
    expect(result.items[0]).toEqual({ "test": {} });
    expect(result.buffer).toEqual("{\"test\": [{}");

    result = parseJsonlStream(result.buffer + "]}");
    expect(1).toEqual(result.items.length);
    expect(result.items[0]).toEqual({ "test": [{}] });
    expect(result.buffer).toEqual("");
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
    expect(result.buffer).toEqual('123');

    // EOF behavior with isEnd
    result = parseJsonlStream('123', true);
    expect(result.items).toEqual([123]);
    expect(result.buffer).toEqual('');
  });
});
