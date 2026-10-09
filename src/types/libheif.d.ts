// Tipos mínimos de libheif-js (versión ESM con el .wasm incluido).
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    get_width(): number
    get_height(): number
    display(target: ImageData, cb: (result: ImageData | null) => void): void
    free?(): void
  }
  interface LibHeif {
    HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] }
  }
  const factory: () => LibHeif
  export default factory
}
