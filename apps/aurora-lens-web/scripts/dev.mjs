import { createServer } from "vite";

const args = process.argv.slice(2);
const defaultHost = "127.0.0.1";
const defaultPort = "5173";

function getOption(name) {
  const index = args.indexOf(`--${name}`);

  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const positional = args.filter((arg, index) => {
  const previous = args[index - 1];
  return !arg.startsWith("--") && previous !== "--host" && previous !== "--port";
});

const host =
  normalizeHost(
    getOption("host") ??
      (process.env.npm_config_host && process.env.npm_config_host !== "true"
        ? process.env.npm_config_host
        : undefined) ??
      positional.find((arg) => Number.isNaN(Number(arg))) ??
      defaultHost
  );

const portValue =
  getOption("port") ??
  (process.env.npm_config_port && process.env.npm_config_port !== "true"
    ? process.env.npm_config_port
    : undefined) ??
  positional.find((arg) => !Number.isNaN(Number(arg))) ??
  defaultPort;

function normalizeHost(value) {
  return value === "localhost" ? defaultHost : value;
}

const server = await createServer({
  server: {
    host,
    port: Number(portValue),
  },
});

await server.listen();
server.printUrls();
