import thermos from "../thermos/opencode/index.js"
import pstack from "../pstack/opencode/index.js"

export default {
  id: "alandotcom.plugins",
  async setup(ctx) {
    await thermos.setup(ctx)
    await pstack.setup(ctx)
  },
}
