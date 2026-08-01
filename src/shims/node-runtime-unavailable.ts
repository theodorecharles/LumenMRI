const nodeRuntimeUnavailable = new Proxy(
  {},
  {
    get: (_target, property) => {
      throw new Error(`Node-only API ${String(property)} is unavailable in the browser`)
    },
  },
)

export default nodeRuntimeUnavailable
