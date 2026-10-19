# DeepSeek Harness

English | [中文](README.zh.md)

> **Fork notice** — this fork adds Docker packaging and a scheduled image build on top of upstream.
> Images are published to `ghcr.io/workbuddy-repo/deepseek-harness`, tagged with the dsh version and `latest`
> (any release whose version does not contain `alpha`).
> Deployment guide and troubleshooting: [docker/README.md](docker/README.md).

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

### Run from Docker

Prebuilt images are available at `ghcr.io/workbuddy-repo/deepseek-harness`. The repository's
[`docker-compose.yml`](docker-compose.yml) only pulls and runs — it never builds locally.

```sh
mkdir -p data workspace
sudo chown -R 1000:1000 data workspace   # must match the container user

docker compose up -d
docker logs dsh | grep 'token='          # open the printed URL, token included
```

Two bind mounts carry all mutable state: `./data` holds sessions, credentials, profiles and installed
plugins (`DSH_HOME`); `./workspace` is the directory the agent reads and writes.

Two things are easy to get wrong:

- **Set `DSH_LAN_ADDR` to the address you type in the browser.** The container cannot bind `0.0.0.0`,
  so the entrypoint resolves the container address at startup, while `/api` requests are fenced by the
  browser's `Host` header. If the two disagree, the page loads but every API call returns `403`.
- **The first visit must carry `?token=`.** Opening the bare `IP:3080` (or the NAS panel's "open" button,
  which does not append a token) returns `401`. The login cookie is issued on the first token visit; after
  that the bare address works.

Full guide, environment variables and a troubleshooting sequence: [docker/README.md](docker/README.md).

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/4MrtZUhpxg">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
