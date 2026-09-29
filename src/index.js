import { Container, getContainer } from "@cloudflare/containers";

export class LuraphContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "30m";
  instance_type = "standard-1";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const container = getContainer(env.LURAPH_CONTAINER, "deobfuscator");
      return container.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
