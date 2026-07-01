
import { IncompleteError, JsonParserError } from "./error";


// Parses a buffer containing newline-delimited JSON (JSONL) records.
// Returns the parsed items, any incomplete trailing text, and the newline state for the next chunk.
export const parseJsonlStream = <T>(
  buffer: string,
  isEnd = false,
  hasNewlineSinceLastItem = true
): { items: T[]; remaining: string; hasNewlineSinceLastItem: boolean } => {
  try {
    return new Decoder<T>(hasNewlineSinceLastItem).decode(buffer, isEnd);
  } catch (err: unknown) {
    const originalError = err instanceof Error ? err : new Error(String(err));
    throw new JsonParserError(
      `JSONL parsing failed: ${originalError.message}`,
      originalError,
      {
        bufferLength: buffer.length,
        buffer: buffer,
      }
    );
  }
};

// Internal parser class that maintains decoding state across a single chunk's character stream.
class Decoder<T> {
  // The input string buffer being parsed.
  private text = "";
  // The current character position in the buffer.
  private pos = 0;
  // Indicates if this is the final chunk in the stream (end of file).
  private isEnd = false;
  // Tracks if a newline has been encountered since the last successfully parsed JSON value.
  private hasNewlineSinceLastItem = true;

  constructor(hasNewlineSinceLastItem = true) {
    this.hasNewlineSinceLastItem = hasNewlineSinceLastItem;
  }

  // Decodes a JSONL string buffer, returning parsed records and tracking buffer remains.
  decode(jsonl: string, isEnd: boolean): { items: T[], remaining: string, hasNewlineSinceLastItem: boolean } {
    this.text = jsonl;
    this.pos = 0;
    this.isEnd = isEnd;

    let start = 0;
    const items: T[] = [];

    while (this.pos < this.text.length) {
      // Consume any leading whitespace and check if a newline boundary is present.
      const sawNewline = this.skipWhitespace();
      if (sawNewline) {
        this.hasNewlineSinceLastItem = true;
      }
      start = this.pos;
      if (this.pos >= this.text.length) break;

      // Enforce the rule that consecutive JSON records must be separated by at least one newline.
      if (!this.hasNewlineSinceLastItem) {
        throw new Error(`Multiple JSON records on the same line are not allowed at position ${this.pos}`);
      }

      try {
        const value = this.parseValue() as T;
        items.push(value);
        start = this.pos;
        // Reset newline flag to require a new line delimiter before the next JSON value.
        this.hasNewlineSinceLastItem = false;
      } catch (e: any) {
        // Halt parsing on incomplete structures to wait for more data.
        if (e instanceof IncompleteError) {
          break;
        } else {
          throw e;
        }
      }
    }

    // Check for a trailing newline at the end of the input chunk.
    const sawNewlineAtEnd = this.skipWhitespace();
    if (sawNewlineAtEnd) {
      this.hasNewlineSinceLastItem = true;
    }

    const remaining = this.text.substring(start, this.text.length);

    return {
      items,
      remaining,
      hasNewlineSinceLastItem: this.hasNewlineSinceLastItem,
    };
  }

  // Resolves the JSON value at the current position based on the first character.
  private parseValue(): any {
    this.skipWhitespace();
    if (this.pos >= this.text.length) throw new IncompleteError();

    const char = this.text.charCodeAt(this.pos);

    if (char === 123) { // '{'
      return this.parseObject();
    } else if (char === 91) { // '['
      return this.parseArray();
    } else if (char === 34) { // '"'
      return this.parseString();
    } else if (char === 116) { // 't'
      return this.parseTrue();
    } else if (char === 102) { // 'f'
      return this.parseFalse();
    } else if (char === 110) { // 'n'
      return this.parseNull();
    } else if ((char >= 48 && char <= 57) || char === 45) { // '0'-'9' or '-'
      return this.parseNumber();
    } else {
      throw new Error(`Unexpected token '${this.text[this.pos]}' at position ${this.pos}`);
    }
  }

  // Parses a JSON object starting at the current position.
  private parseObject(): Record<string, any> {
    this.nextPos(); // skip '{'
    const obj: Record<string, any> = {};
    let initial = true;

    while (true) {
      this.skipWhitespace();
      if (this.pos >= this.text.length) throw new IncompleteError();

      if (this.text.charCodeAt(this.pos) === 125) { // '}'
        this.nextPos();
        return obj;
      }

      if (!initial) {
        if (this.text.charCodeAt(this.pos) !== 44) { // ','
          throw new Error(`Expected ',' in object at position ${this.pos}`);
        }
        this.nextPos(); // skip ','
        this.skipWhitespace();
      }

      if (this.pos >= this.text.length) throw new IncompleteError();
      if (this.text.charCodeAt(this.pos) !== 34) { // '"'
        throw new Error(`Expected string key in object at position ${this.pos}`);
      }

      const key = this.parseString();

      this.skipWhitespace();
      if (this.pos >= this.text.length) throw new IncompleteError();

      if (this.text.charCodeAt(this.pos) !== 58) { // ':'
        throw new Error(`Expected ':' after key in object at position ${this.pos}`);
      }
      this.nextPos(); // skip ':'

      const value = this.parseValue();
      obj[key] = value;
      initial = false;
    }
  }

  // Parses a JSON array starting at the current position.
  private parseArray(): any[] {
    this.nextPos(); // skip '['
    const arr: any[] = [];
    let initial = true;

    while (true) {
      this.skipWhitespace();
      if (this.pos >= this.text.length) throw new IncompleteError();

      if (this.text.charCodeAt(this.pos) === 93) { // ']'
        this.nextPos();
        return arr;
      }

      if (!initial) {
        if (this.text.charCodeAt(this.pos) !== 44) { // ','
          throw new Error(`Expected ',' in array at position ${this.pos}`);
        }
        this.nextPos(); // skip ','
      }

      const value = this.parseValue();
      arr.push(value);
      initial = false;
    }
  }

  // Skips whitespace characters (spaces, tabs, newlines) and returns whether a newline was encountered.
  private skipWhitespace(): boolean {
    let sawNewline = false;
    while (this.pos < this.text.length) {
      const char = this.text.charCodeAt(this.pos);
      if (char === 32 || char === 9) { // space, tab
        this.pos++;
      } else if (char === 10 || char === 13) { // LF, CR
        sawNewline = true;
        this.pos++;
      } else {
        break;
      }
    }
    return sawNewline;
  }

  // Parses a JSON string starting at the current position, handling escape sequences and validating control characters.
  private parseString(): string {
    this.nextPos(); // skip opening '"'
    let start = this.pos;
    let result = "";

    while (this.pos < this.text.length) {
      const char = this.text.charCodeAt(this.pos);
      // Validate that the string does not contain unescaped raw control characters (range 0x00 to 0x1F).
      if (char <= 0x1f) {
        throw new Error(`Unescaped control character U+${char.toString(16).padStart(4, "0")} at position ${this.pos}`);
      }

      if (char === 34) { // '"'
        result += this.text.substring(start, this.pos);
        this.nextPos(); // skip closing '"'
        return result;
      } else if (char === 92) { // '\\'
        result += this.text.substring(start, this.pos);
        this.nextPos(); // skip '\'
        if (this.pos >= this.text.length) throw new IncompleteError();

        const escChar = this.text[this.pos];
        // Decode valid JSON escape characters.
        if (escChar === '"' || escChar === '\\' || escChar === '/') {
          result += escChar;
        } else if (escChar === 'b') result += '\b';
        else if (escChar === 'f') result += '\f';
        else if (escChar === 'n') result += '\n';
        else if (escChar === 'r') result += '\r';
        else if (escChar === 't') result += '\t';
        else if (escChar === 'u') {
          // Decode Unicode escape sequence (\uXXXX) and validate that it is exactly 4 hex characters.
          if (this.pos + 4 >= this.text.length) throw new IncompleteError();
          const hex = this.text.substring(this.pos + 1, this.pos + 5);
          for (let i = 0; i < 4; i++) {
            if (!isHexChar(hex.charCodeAt(i))) {
              throw new Error(`Invalid Unicode escape sequence \\u${hex} at position ${this.pos}`);
            }
          }
          result += String.fromCharCode(parseInt(hex, 16));
          this.nextPos(4); // skip 4 hex chars
        } else {
          throw new Error(`Invalid escape character \\${escChar} at ${this.pos}`);
        }
        this.nextPos(); // skip the escape character
        start = this.pos;
      } else {
        this.nextPos();
      }
    }
    throw new IncompleteError();
  }

  // Parses the literal 'true' starting at the current position.
  private parseTrue(): boolean {
    if (this.pos + 3 >= this.text.length) throw new IncompleteError();
    if (this.text.substring(this.pos, this.pos + 4) === "true") {
      this.nextPos(4);
      return true;
    }
    throw new Error(`Expected 'true' at ${this.pos}`);
  }

  // Parses the literal 'false' starting at the current position.
  private parseFalse(): boolean {
    if (this.pos + 4 >= this.text.length) throw new IncompleteError();
    if (this.text.substring(this.pos, this.pos + 5) === "false") {
      this.nextPos(5);
      return false;
    }
    throw new Error(`Expected 'false' at ${this.pos}`);
  }

  // Parses the literal 'null' starting at the current position.
  private parseNull(): null {
    if (this.pos + 3 >= this.text.length) throw new IncompleteError();
    if (this.text.substring(this.pos, this.pos + 4) === "null") {
      this.nextPos(4);
      return null;
    }
    throw new Error(`Expected 'null' at ${this.pos}`);
  }

  // Parses a JSON number starting at the current position, validating JSON-compliant syntax.
  private parseNumber(): number {
    const start = this.pos;
    let hasDot = false;
    let hasE = false;

    while (this.pos < this.text.length) {
      const char = this.text.charCodeAt(this.pos);
      const prevChar = this.pos > start ? this.text.charCodeAt(this.pos - 1) : null;

      if (char >= 48 && char <= 57) { // 0-9
        this.nextPos();
      } else if (char === 45) { // -
        // A minus sign is allowed at the beginning or immediately after exponent markers 'e' or 'E'.
        if (prevChar === null || prevChar === 101 || prevChar === 69) {
          this.nextPos();
        } else {
          break;
        }
      } else if (char === 43) { // +
        // A plus sign is allowed only immediately after exponent markers 'e' or 'E'.
        if (prevChar === 101 || prevChar === 69) {
          this.nextPos();
        } else {
          break;
        }
      } else if (char === 46) { // .
        // A decimal point is allowed only once, before the exponent marker, and following a digit.
        if (!hasDot && !hasE && prevChar !== null && prevChar >= 48 && prevChar <= 57) {
          hasDot = true;
          this.nextPos();
        } else {
          break;
        }
      } else if (char === 101 || char === 69) { // e or E
        // An exponent marker is allowed only once, and following a digit.
        if (!hasE && prevChar !== null && prevChar >= 48 && prevChar <= 57) {
          hasE = true;
          this.nextPos();
        } else {
          break;
        }
      } else {
        break;
      }
    }

    // If parsing stops at the end of a non-terminal chunk, signal incomplete data.
    if (this.pos >= this.text.length && !this.isEnd) {
      throw new IncompleteError();
    }

    const numStr = this.text.substring(start, this.pos);
    if (!isValidJsonNumber(numStr)) {
      throw new Error(`Invalid number format '${numStr}' at ${start}`);
    }
    return Number(numStr);
  }

  // Advances the internal position pointer by the specified step size.
  private nextPos(inc = 1): void {
    this.pos += inc;
  }
}

// Validates that the number string strictly conforms to RFC 8259 JSON grammar.
function isValidJsonNumber(str: string): boolean {
  const len = str.length;
  if (len === 0) return false;

  let i = 0;

  // 1. Sign
  if (str.charCodeAt(i) === 45) { // '-'
    i++;
  }

  // Need at least one digit/character after sign
  if (i >= len) {
    return false;
  }

  // 2. Integer part
  const firstDigit = str.charCodeAt(i);
  if (firstDigit === 48) { // '0'
    i++;
    // If it is '0', the next char cannot be another digit (no leading zero like 01)
    if (i < len) {
      const nextChar = str.charCodeAt(i);
      if (nextChar >= 48 && nextChar <= 57) {
        return false;
      }
    }
  } else if (firstDigit >= 49 && firstDigit <= 57) { // '1'-'9'
    i++;
    while (i < len) {
      const char = str.charCodeAt(i);
      if (char >= 48 && char <= 57) {
        i++;
      } else {
        break;
      }
    }
  } else {
    // Expected a digit
    return false;
  }

  // 3. Fraction part
  if (i < len && str.charCodeAt(i) === 46) { // '.'
    i++;
    // Must have at least one digit after '.'
    if (i >= len) return false;
    const firstFrac = str.charCodeAt(i);
    if (firstFrac < 48 || firstFrac > 57) return false;
    i++;
    while (i < len) {
      const char = str.charCodeAt(i);
      if (char >= 48 && char <= 57) {
        i++;
      } else {
        break;
      }
    }
  }

  // 4. Exponent part
  if (i < len) {
    const expChar = str.charCodeAt(i);
    if (expChar === 101 || expChar === 69) { // 'e' or 'E'
      i++;
      if (i >= len) return false;

      const signChar = str.charCodeAt(i);
      if (signChar === 43 || signChar === 45) { // '+' or '-'
        i++;
      }

      if (i >= len) return false;
      const firstExpDigit = str.charCodeAt(i);
      if (firstExpDigit < 48 || firstExpDigit > 57) return false;
      i++;
      while (i < len) {
        const char = str.charCodeAt(i);
        if (char >= 48 && char <= 57) {
          i++;
        } else {
          break;
        }
      }
    }
  }

  // Must consume the whole string
  return i === len;
}

// Determines if a character code represents a valid hexadecimal digit ([0-9], [A-F], [a-f]).
function isHexChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||  // '0'-'9'
    (code >= 65 && code <= 70) ||  // 'A'-'F'
    (code >= 97 && code <= 102)    // 'a'-'f'
  );
}

