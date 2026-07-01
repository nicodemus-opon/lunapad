# AI assistant

A chat panel that builds and edits models for you, conversationally, instead of you writing every cell by hand.

## What it does

Ask for a model in plain language and the assistant works through it in stages:

1. **Discovery**, checks whether an existing model already does roughly what you're asking for, so you don't end up with three near-duplicate models.
2. **Modeling**, proposes a name, materialization, dependencies, and grain for the new model before writing any SQL.
3. **Generation**, writes the actual PRQL or SQL.
4. **Review**, scores its own output on correctness, completeness, performance, and convention, and generates a handful of data-specific assertions (simple boolean SQL checks) you can run to catch regressions later.

You stay in the loop at each stage rather than just getting a finished model dropped on you.

![The AI panel's empty state, with suggested prompts like "Analyze orders by region and month" and "Create a revenue dashboard"](images/07-ai-panel.png)

## Workspace standards

Tell the assistant your team's conventions once, naming patterns, preferred materializations, style rules, and it factors them into everything it proposes afterward. Set this from the AI panel's settings rather than repeating yourself in every conversation.

## Sprint board

AI-driven build tasks show up on a board so you can track what's in progress, what's done, and what's still queued, useful once you've got the assistant working on more than one thing.

## Memory

The assistant remembers past prompts and outcomes, so a request similar to one you've made before benefits from what worked (or didn't) last time, rather than starting cold every conversation.

## Setup: bring your own LLM

There's no built-in hosted model. The assistant talks to whatever you point it at, either a local [Ollama](https://ollama.com) install or any OpenAI-compatible API.

Open Settings → AI:

| Field    | What to put                                           |
| -------- | ----------------------------------------------------- |
| Provider | `Ollama` or `OpenAPI-compatible`                      |
| Base URL | Your Ollama or API endpoint                           |
| API key  | Optional, leave blank for a local Ollama with no auth |
| Model    | The model name, e.g. `qwen3:4b` for Ollama            |

![Settings → AI configured with an OpenAPI-compatible provider, a base URL, a masked API key, and a model name](images/07-settings-ai.png)

For Ollama, `qwen3:1.7b` is fast and `qwen3:4b` is better quality but slower. Without a provider configured here, the AI panel has nothing to talk to and won't do anything.

If you're self-hosting with Docker Compose and running Ollama on the host machine, point the base URL at `http://host.docker.internal:11434` (already wired up in the bundled `docker-compose.yml`, see [self-hosting](11-self-hosting.md)).

## Next

[dbt projects](08-dbt-projects.md).
