declare module '@cornerstonejs/codec-openjpeg' {
  interface J2KDecoder {
    getEncodedBuffer(length: number): Uint8Array
    decode(): void
    getDecodedBuffer(): Uint8Array
    delete(): void
  }

  interface OpenJPEGModule {
    J2KDecoder: new () => J2KDecoder
  }

  export default function OpenJPEGJS(options?: {
    print?: (...values: unknown[]) => void
    printErr?: (...values: unknown[]) => void
  }): Promise<OpenJPEGModule>
}
