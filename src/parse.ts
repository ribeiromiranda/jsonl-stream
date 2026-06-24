
export class IncompleteError extends Error {
  constructor() {
    super("Incomplete chunk");
    this.name = "IncompleteError";
  }
}

export const parseJsonlStream = (buffer: string, isEnd = false): { items: any[]; buffer: string; } => {
  return new Decoder().decode(buffer, isEnd);
};

class Decoder {
  private text = "";
  private pos = 0;
  private isEnd = false;

  decode(jsonl: string, isEnd: boolean): { items: any[], buffer: string } {
    this.text = jsonl;
    this.pos = 0;
    this.isEnd = isEnd;

    let start = 0;
    const items: any[] = [];

    while (this.pos < this.text.length) {
      this.skipWhitespace();
      start = this.pos;
      if (this.pos >= this.text.length) break;

      try {
        const value = this.parseValue();
        items.push(value);
        start = this.pos;
      } catch (e: any) {
        if (e instanceof IncompleteError) {
          break;
        } else {
          throw e;
        }
      }
    }

    const buffer = this.text.substring(start, this.text.length);

    return {
      items,
      buffer,
    };
  }

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

  private skipWhitespace(): void {
    while (this.pos < this.text.length) {
      const char = this.text.charCodeAt(this.pos);
      if (char === 32 || char === 10 || char === 13 || char === 9) {
        this.pos++;
      } else {
        break;
      }
    }
  }

  private parseString(): string {
    this.nextPos(); // skip opening '"'
    let start = this.pos;
    let result = "";

    while (this.pos < this.text.length) {
      const char = this.text.charCodeAt(this.pos);
      if (char === 34) { // '"'
        result += this.text.substring(start, this.pos);
        this.nextPos(); // skip closing '"'
        return result;
      } else if (char === 92) { // '\\'
        result += this.text.substring(start, this.pos);
        this.nextPos(); // skip '\'
        if (this.pos >= this.text.length) throw new IncompleteError();

        const escChar = this.text[this.pos];
        if (escChar === '"' || escChar === '\\' || escChar === '/') {
          result += escChar;
        } else if (escChar === 'b') result += '\b';
        else if (escChar === 'f') result += '\f';
        else if (escChar === 'n') result += '\n';
        else if (escChar === 'r') result += '\r';
        else if (escChar === 't') result += '\t';
        else if (escChar === 'u') {
          if (this.pos + 4 >= this.text.length) throw new IncompleteError();
          const hex = this.text.substring(this.pos + 1, this.pos + 5);
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

  private parseTrue(): boolean {
    if (this.pos + 3 >= this.text.length) throw new IncompleteError();
    if (this.text.substring(this.pos, this.pos + 4) === "true") {
      this.nextPos(4);
      return true;
    }
    throw new Error(`Expected 'true' at ${this.pos}`);
  }

  private parseFalse(): boolean {
    if (this.pos + 4 >= this.text.length) throw new IncompleteError();
    if (this.text.substring(this.pos, this.pos + 5) === "false") {
      this.nextPos(5);
      return false;
    }
    throw new Error(`Expected 'false' at ${this.pos}`);
  }

  private parseNull(): null {
    if (this.pos + 3 >= this.text.length) throw new IncompleteError();
    if (this.text.substring(this.pos, this.pos + 4) === "null") {
      this.nextPos(4);
      return null;
    }
    throw new Error(`Expected 'null' at ${this.pos}`);
  }

  private parseNumber(): number {
    const start = this.pos;
    while (this.pos < this.text.length) {
      const char = this.text.charCodeAt(this.pos);
      if (
        (char >= 48 && char <= 57) || // 0-9
        char === 45 || // -
        char === 43 || // +
        char === 46 || // .
        char === 101 || // e
        char === 69 // E
      ) {
        this.nextPos();
      } else {
        break;
      }
    }

    if (this.pos >= this.text.length && !this.isEnd) {
      throw new IncompleteError();
    }

    const numStr = this.text.substring(start, this.pos);
    const num = Number(numStr);
    if (isNaN(num)) {
      throw new Error(`Invalid number format '${numStr}' at ${start}`);
    }
    return num;
  }

  private nextPos(inc = 1): void {
    this.pos += inc;
  }
}
