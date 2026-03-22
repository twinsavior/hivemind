# Language & Framework Detection Reference

Lookup table for identifying project types from their config files. Check the project root for these files in priority order — the first match determines the primary language/framework.

## Config File Signatures

### JavaScript / TypeScript
| File | Indicates |
|------|-----------|
| `package.json` | Node.js project (check `type: "module"` for ESM vs CJS) |
| `tsconfig.json` | TypeScript project (check `strict`, `target`, `module` fields) |
| `deno.json` / `deno.jsonc` | Deno runtime |
| `bun.lockb` / `bunfig.toml` | Bun runtime |

**Framework detection** (check `dependencies` in `package.json`):
| Dependency | Framework |
|-----------|-----------|
| `next` | Next.js (React SSR/SSG) |
| `react` / `react-dom` | React SPA |
| `vue` | Vue.js |
| `@angular/core` | Angular |
| `svelte` / `@sveltejs/kit` | Svelte / SvelteKit |
| `express` | Express.js server |
| `fastify` | Fastify server |
| `hono` | Hono server |
| `@nestjs/core` | NestJS (enterprise Node) |
| `electron` | Electron desktop app |
| `react-native` | React Native mobile |
| `astro` | Astro static site |
| `nuxt` | Nuxt (Vue SSR) |
| `remix` | Remix (React SSR) |

**Build tool detection**:
| File | Tool |
|------|------|
| `vite.config.*` | Vite |
| `webpack.config.*` | Webpack |
| `rollup.config.*` | Rollup |
| `esbuild.*` / scripts mentioning esbuild | esbuild |
| `turbo.json` | Turborepo (monorepo) |
| `nx.json` | Nx (monorepo) |
| `lerna.json` | Lerna (monorepo, legacy) |

**Test framework detection** (check `devDependencies`):
| Dependency | Framework |
|-----------|-----------|
| `vitest` | Vitest |
| `jest` | Jest |
| `mocha` | Mocha |
| `ava` | Ava |
| `playwright` / `@playwright/test` | Playwright (E2E) |
| `cypress` | Cypress (E2E) |
| `@testing-library/*` | Testing Library (component) |

### Python
| File | Indicates |
|------|-----------|
| `pyproject.toml` | Modern Python project (check `[tool.poetry]` vs `[project]`) |
| `setup.py` / `setup.cfg` | Legacy Python packaging |
| `requirements.txt` | Pip dependencies (no build system) |
| `Pipfile` | Pipenv |
| `poetry.lock` | Poetry |
| `uv.lock` | uv package manager |
| `conda.yaml` / `environment.yml` | Conda environment |

**Framework detection**:
| Import / Dependency | Framework |
|--------------------|-----------|
| `django` | Django |
| `flask` | Flask |
| `fastapi` | FastAPI |
| `pytorch` / `torch` | PyTorch (ML) |
| `tensorflow` | TensorFlow (ML) |
| `pandas` / `numpy` | Data science |
| `scrapy` | Web scraping |
| `celery` | Task queue |

### Rust
| File | Indicates |
|------|-----------|
| `Cargo.toml` | Rust project (check `[workspace]` for monorepo) |
| `Cargo.lock` | Locked dependency versions |
| `rust-toolchain.toml` | Specific Rust version pinned |

**Framework detection** (check `[dependencies]` in `Cargo.toml`):
| Crate | Framework |
|-------|-----------|
| `actix-web` | Actix Web server |
| `axum` | Axum server |
| `rocket` | Rocket server |
| `tokio` | Async runtime |
| `serde` | Serialization |
| `clap` | CLI framework |
| `tauri` | Tauri desktop app |
| `bevy` | Bevy game engine |
| `wasm-bindgen` | WebAssembly |

### Go
| File | Indicates |
|------|-----------|
| `go.mod` | Go module (check module path for org/project) |
| `go.sum` | Locked dependency versions |
| `go.work` | Go workspace (multi-module) |

**Framework detection** (check `require` in `go.mod`):
| Module | Framework |
|--------|-----------|
| `github.com/gin-gonic/gin` | Gin HTTP |
| `github.com/gofiber/fiber` | Fiber HTTP |
| `github.com/gorilla/mux` | Gorilla Mux router |
| `google.golang.org/grpc` | gRPC |
| `github.com/spf13/cobra` | Cobra CLI |
| `gorm.io/gorm` | GORM ORM |
| `entgo.io/ent` | Ent ORM |

### Java / Kotlin
| File | Indicates |
|------|-----------|
| `pom.xml` | Maven (Java/Kotlin) |
| `build.gradle` / `build.gradle.kts` | Gradle |
| `settings.gradle` | Multi-module Gradle project |
| `.mvn/` | Maven wrapper |

**Framework detection**:
| Dependency | Framework |
|-----------|-----------|
| `spring-boot` | Spring Boot |
| `quarkus` | Quarkus |
| `micronaut` | Micronaut |
| `android` (in plugins) | Android app |
| `ktor` | Ktor (Kotlin server) |

### C / C++
| File | Indicates |
|------|-----------|
| `CMakeLists.txt` | CMake build system |
| `Makefile` / `GNUmakefile` | Make |
| `meson.build` | Meson build system |
| `conanfile.txt` / `conanfile.py` | Conan package manager |
| `vcpkg.json` | vcpkg package manager |
| `.clang-format` | Clang formatting configured |

### Ruby
| File | Indicates |
|------|-----------|
| `Gemfile` | Ruby with Bundler |
| `Rakefile` | Ruby with Rake tasks |
| `config.ru` | Rack-compatible web app |
| `Gemfile.lock` | Locked dependency versions |

**Framework detection** (check `Gemfile`):
| Gem | Framework |
|-----|-----------|
| `rails` | Ruby on Rails |
| `sinatra` | Sinatra |
| `hanami` | Hanami |
| `rspec` | RSpec testing |

### Elixir
| File | Indicates |
|------|-----------|
| `mix.exs` | Elixir/Mix project |
| `mix.lock` | Locked dependencies |

**Framework detection**:
| Dependency | Framework |
|-----------|-----------|
| `phoenix` | Phoenix web |
| `ecto` | Ecto database |
| `nerves` | Nerves IoT |
| `livebook` | Livebook notebooks |

### Swift
| File | Indicates |
|------|-----------|
| `Package.swift` | Swift Package Manager |
| `*.xcodeproj` / `*.xcworkspace` | Xcode project (iOS/macOS) |
| `Podfile` | CocoaPods (iOS, legacy) |

### .NET (C# / F#)
| File | Indicates |
|------|-----------|
| `*.csproj` | C# project |
| `*.fsproj` | F# project |
| `*.sln` | Visual Studio solution |
| `global.json` | .NET SDK version |
| `nuget.config` | NuGet package config |

## CI/CD Detection

| File / Directory | System |
|-----------------|--------|
| `.github/workflows/` | GitHub Actions |
| `.gitlab-ci.yml` | GitLab CI |
| `Jenkinsfile` | Jenkins |
| `.circleci/config.yml` | CircleCI |
| `.travis.yml` | Travis CI (legacy) |
| `azure-pipelines.yml` | Azure DevOps |
| `bitbucket-pipelines.yml` | Bitbucket Pipelines |
| `.buildkite/` | Buildkite |

## Container / Infrastructure

| File | Indicates |
|------|-----------|
| `Dockerfile` | Docker containerization |
| `docker-compose.yml` / `compose.yml` | Docker Compose multi-service |
| `kubernetes/` / `k8s/` / `*.yaml` with `apiVersion` | Kubernetes |
| `terraform/` / `*.tf` | Terraform IaC |
| `pulumi/` / `Pulumi.yaml` | Pulumi IaC |
| `serverless.yml` | Serverless Framework |
| `fly.toml` | Fly.io deployment |
| `vercel.json` | Vercel deployment |
| `netlify.toml` | Netlify deployment |
| `railway.json` / `railway.toml` | Railway deployment |
| `render.yaml` | Render deployment |

## Code Quality / Formatting

| File | Tool |
|------|------|
| `.eslintrc.*` / `eslint.config.*` | ESLint |
| `.prettierrc` / `prettier.config.*` | Prettier |
| `biome.json` | Biome (lint + format) |
| `.editorconfig` | EditorConfig |
| `rustfmt.toml` | Rust formatter |
| `.golangci.yml` | GolangCI-Lint |
| `ruff.toml` / `[tool.ruff]` in pyproject | Ruff (Python) |
| `.rubocop.yml` | RuboCop (Ruby) |

## Tips for Accurate Detection

1. **Check multiple signals.** A `package.json` with `next` dependency + `tsconfig.json` = Next.js TypeScript project, not just "a Node project."
2. **Read config values.** `tsconfig.json` with `"strict": true` and `"target": "ES2022"` tells you the team enforces strict TypeScript targeting modern runtimes.
3. **Monorepo indicators.** Multiple `package.json` files, `workspaces` field, `turbo.json`, `nx.json`, or `lerna.json` mean a monorepo. Map each package separately.
4. **Polyglot projects.** Some projects use multiple languages (e.g., TypeScript frontend + Go backend). Detect all of them and note which is primary vs secondary.
5. **Generated vs authored.** Files in `dist/`, `build/`, `gen/`, `generated/` are build artifacts. Don't count them as source code.
