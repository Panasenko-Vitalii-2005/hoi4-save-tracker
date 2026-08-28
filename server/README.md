<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run build
$ npm run start:prod
```

### Save analysis workers

On a cache miss, `POST /api/analyze` runs the existing save parser in a new Node.js
Worker Thread. Only the file path is sent; the worker reads/decodes the save and
returns the unchanged analysis result. Uploaded files are removed after analysis
settles, including on cache hits, parse errors or crashes.

`HOI4_ANALYSIS_WORKERS` is a positive integer, default **1**, limiting active
analyses per backend process. Excess cache misses for different contents receive
**503** and may be retried; there is no waiting queue or worker pool. With the
default, two simultaneous distinct uncached saves admit one and reject one;
five admit one and reject four. Identical contents share an in-flight analysis,
and completed cache hits do not use a worker slot. Raising the
limit permits parallel analyses but multiplies large-save heap usage and CPU
demand. Do not size it solely by logical CPU count. No new analysis timeout is
imposed. Result deserialization and HTTP JSON serialization still use the main thread.

Nest start/watch and production use emitted workers under
`dist/src/hoi4/workers/`. `npm run start:prod` runs `dist/src/main.js`, matching
the existing Docker entry. Source execution (including Jest) uses the existing
dev-only `ts-node` loader; production workers do not require it.

### Analysis result cache

Both JSON/path requests and uploads use a streaming SHA-256 of the raw file bytes
before analysis. Filenames, paths and timestamps are not cache keys. Identical
bytes share a result even under different names; different compressed encodings
of the same decoded save are separate entries. Hashing reads the file once in
bounded chunks without allocating a full-file buffer; a cache miss then lets
the worker read/decode the file as before. Local saves must remain unchanged
during hashing and analysis; use a stable copy rather than a file being rewritten.

`HOI4_ANALYSIS_CACHE_ENTRIES` is a positive integer, default **3**. Missing or
invalid values fall back to 3. The cache holds only successful results, evicting
the least recently accessed entry when full. It is **process-local memory**, not
durable storage: restart clears it, and separate backend processes do not share
it. The control save's result is about 6.55 MiB serialized / 11.1 MiB retained
heap in a sample measurement; three such entries are roughly 33 MiB of result
heap, in addition to workers, in-flight results and HTTP serialization. This is
an entry-count bound, not a byte limit; modded results may be larger.

Concurrent requests with the same hash await one analysis. Failures (including
503 and worker crashes) are neither cached nor retained as in-flight entries,
so a later request can retry. Each upload retains and cleans up only its own
temporary file after its awaited analysis settles. A duplicate caller or client
disconnect does not cancel the worker or delete another caller's file.

Results are treated as immutable and serialized directly, without expensive
deep copies. Cache code never modifies them. `parse_seconds` remains the duration
of the original parser execution, **not** current request latency or a cache-hit
indicator. The response shape is unchanged; upload, hashing and serialization
still take time on a hit. No cache state or hashes are logged or added to the API.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
