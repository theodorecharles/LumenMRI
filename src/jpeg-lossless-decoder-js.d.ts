declare module 'jpeg-lossless-decoder-js' {
  export class Decoder {
    constructor(buffer?: ArrayBuffer, numBytes?: number)
    decompress(buffer: ArrayBuffer, offset?: number, length?: number): ArrayBuffer
  }
}
