/**
 * Ejecuta `fn` sobre cada elemento con como mucho `limit` tareas a la vez,
 * conservando el orden de los resultados. Si una tarea lanza, se detienen
 * las demás en cuanto terminen su elemento actual y se propaga el error.
 */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed: unknown = null
  const worker = async () => {
    while (failed === null) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i], i)
      } catch (err) {
        failed ??= err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  if (failed !== null) throw failed
  return results
}
