# Ask Panel — chemistry tutor Q&A inside ChemSim

The bottom-right **💬 Ask** button opens a tutor panel. A student types a
question ("why aren't the CCl4 molecules moving as much as the water?"),
the current simulation state is captured, and the whole package is sent
to an LLM along with a ChemSim-specific system prompt. The answer
renders inline.

Two backends are supported:

- **Anthropic Messages API** directly from the browser
- **OpenAI-compatible `/v1/chat/completions`** endpoints — Ollama,
  LM Studio, vLLM, llama.cpp server, OpenAI itself

Settings are persisted in `localStorage` so the student doesn't re-enter
them each session.

---

## Anthropic cloud setup (default)

1. Open the Ask panel, expand **Backend & API key**.
2. Backend: `Anthropic`, endpoint: `https://api.anthropic.com/v1/messages`
   (default), key: your `sk-ant-…` key, model:
   `claude-haiku-4-5-20251001` (default).
3. Ask something. Expect 1–3 s latency, ~$0.001 per query.

Haiku 4.5 is the recommended default: fast, cheap, good at intro-to-mid
chemistry. Upgrade to `claude-sonnet-4-6` if you want stronger physics
reasoning and don't mind ~5× the cost.

---

## Local GPU setup via Ollama

```bash
# One-time
ollama serve

ollama pull llama3.1:8b      # ~5 GB, fits 8 GB VRAM
ollama pull qwen2.5:7b       # ~4.5 GB, slightly smarter on STEM
ollama pull phi-4:14b        # ~9 GB, punches above its weight
```

Then in the Ask panel:

- **Backend**: OpenAI-compatible
- **Endpoint**: `http://localhost:11434/v1/chat/completions`
- **API key**: blank (Ollama doesn't check auth locally)
- **Model**: `llama3.1:8b` (or whichever you pulled)

The browser hits localhost directly. First query warms the model in
VRAM (a few seconds); subsequent queries are fast.

### GPU VRAM sweet spots

| VRAM | Model tier | Typical model | Quantization |
|------|-----------|---------------|--------------|
| 8 GB  | 7–8B full precision / 13B Q4 | `llama3.1:8b`, `qwen2.5:7b` | fp16 or Q4 |
| 12 GB | 7–8B FP16 / 14B Q4 comfortable | `phi-4:14b`, `qwen2.5:14b` | Q4 |
| 16 GB | 14B FP16 / 32B Q4 | `qwen2.5:14b-instruct`, `qwen2.5:32b-q4_K_M` | Q4 |
| 24 GB | 32B FP16 / 70B Q4 | `llama3.3:70b-instruct-q4_K_M` (barely fits) | Q4 |
| 48 GB | 70B FP16 | any 70B at FP16 | fp16 |

4-bit 70B models (~40 GB) will offload to CPU on anything below 48 GB
and become painfully slow. 7–14B is the sweet spot for interactive
classroom Q&A.

### Alternatives to Ollama

- **LM Studio**: GUI-driven, exposes the same OpenAI-compatible API
  on port 1234 by default. Use
  `http://localhost:1234/v1/chat/completions`.
- **vLLM**: high-throughput, ideal for a single shared classroom GPU
  serving 30 concurrent students. Same protocol.
- **llama.cpp server**: lightweight, runs on CPU-only setups too.

---

## Context sent with every query

The panel bundles a short structured snapshot of the current sim
state with each question — click **Sim state sent with your question**
to see it. Example:

```
Mode: Many-Molecule Box
Primary species: Water
Molecule count: 343
Temperature: 240 K
Water model: tip4p-ice
Active experiment: Freezing Water
Ice seed: active (32 frozen waters)
Box size: 24.2 Å
Simulation time: 215.3 ps
Timestep: 3.0 fs
```

This lets the model say things like *"at your current 240 K with
TIP4P/Ice, the seed isn't growing visibly because ice-front
propagation is ~1 Å/ns…"* instead of generic chemistry boilerplate.

## System prompt

Frames the model as a patient tutor, explains what ChemSim can and
can't simulate (classical MD, rigid bodies, no reactions / quantum /
photochemistry), and tells it to cite specific sim state when
relevant. Source of truth: `SYSTEM_PROMPT` in
`src/ui/AskPanel.ts`.

---

## Future extension: per-course RAG

The current implementation uses no vector DB — context is a short
structured string concatenated to the user message. If an instructor
wants the tutor to reference their specific textbook or lesson notes,
add a small RAG layer:

1. Chunk the textbook (per-section or per-paragraph), embed with a
   lightweight embedder (e.g. `nomic-embed-text` via Ollama).
2. Store in a file-based FAISS or sqlite-backed vector store.
3. At query time, retrieve top-k chunks and prepend them to the
   system prompt under a "Course reference" header.

Opt-in per course; the base Q&A doesn't need it.

---

## Grant narrative notes

Cost structure to write into a proposal:

- **Cloud API rollout**: ~$500–$2 000 / year per classroom (Haiku at
  ~$0.001/query, order of thousands of queries).
- **Self-hosted**: one-time $3–8 k for an 8–24 GB GPU server per
  school, zero recurring cost.
- **Hybrid**: cloud for development and low-resource schools,
  self-hosted for privacy-sensitive or offline classrooms. The Ask
  panel supports both without rebuilding.
