/**
 * Classroom Q&A panel: student types a question about what they're
 * seeing, the current simulation state is captured and sent to an LLM
 * along with a ChemSim-specific system prompt, and the answer renders
 * inline.
 *
 * Supports two backends out of the box:
 *   - Anthropic Messages API directly from the browser (with the
 *     `anthropic-dangerous-direct-browser-access` header; user supplies
 *     their own key).
 *   - Any OpenAI-compatible /v1/chat/completions endpoint. Ollama,
 *     LM Studio, vLLM, llama.cpp server, and OpenAI itself all speak
 *     this protocol; point the endpoint field at
 *     `http://localhost:11434/v1/chat/completions` to hit a local
 *     Ollama.
 *
 * Settings are persisted in localStorage so the user doesn't re-enter
 * their key on every reload.
 */

const STORAGE_KEY = 'chemsim.askPanel.v1';

export interface SimState {
  mode: 'mode1' | 'mode2';
  primarySpecies?: string;
  count?: number;
  temperatureK?: number;
  waterModel?: string;
  experimentId?: string | null;
  experimentTitle?: string | null;
  iceSeedActive?: boolean;
  frozenCount?: number;
  periodic?: boolean;
  boxSizeA?: number;
  timePs?: number;
  timestepFs?: number;
  stepCount?: number;
}

type Backend = 'anthropic' | 'openai';

interface Config {
  backend: Backend;
  endpoint: string;
  apiKey: string;
  model: string;
}

const DEFAULT_CONFIG: Config = {
  backend: 'anthropic',
  endpoint: 'https://api.anthropic.com/v1/messages',
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
};

const SYSTEM_PROMPT = `You are a patient chemistry tutor embedded in ChemSim, an \
interactive browser-based molecular dynamics simulator used in classrooms. A \
student is watching molecules move in a 3D box and has asked you a question.

ChemSim is a classical molecular dynamics engine:
- Rigid-body molecules: no bond breaking, no reactions, no quantum effects.
- Pair interactions: Coulomb (with optional TIP4P virtual M-site for water) + \
Lennard-Jones, Lorentz-Berthelot mixing.
- Water models: TIP3P (melts at ~146 K, fast), TIP4P/2005 (melts ~252 K, \
accurate liquid), TIP4P/Ice (melts ~270 K, best for ice demos).
- Other molecules: OPLS-AA or TraPPE partial charges, element-default LJ.
- Integration: Velocity-Verlet + semi-implicit quaternion rotation, \
Berendsen thermostat, optional Berendsen barostat.
- The "freezing demo" uses a pre-built ice Ih seed held fixed via an \
is_frozen flag (pedagogical aid — real nucleation would take microseconds).

Answer concisely (2-4 short paragraphs max). When relevant, cite specific \
values from the simulation state below. If the student asks about something \
ChemSim genuinely can't simulate (bond breaking, electron transfer, \
photochemistry, quantum tunneling), say so briefly rather than making \
something up. Don't invent features the sim doesn't have.`;

export class AskPanel {
  private config: Config;
  private getState: () => SimState;

  constructor(getState: () => SimState) {
    this.getState = getState;
    this.config = this.loadConfig();
  }

  init(): void {
    const askBtn = document.getElementById('ask-btn');
    const askPanel = document.getElementById('ask-panel');
    const askClose = document.getElementById('ask-close');
    const askInput = document.getElementById('ask-input') as HTMLTextAreaElement | null;
    const askSubmit = document.getElementById('ask-submit');
    const askResponse = document.getElementById('ask-response');
    const askContext = document.getElementById('ask-context');

    const backendSel = document.getElementById('ask-backend') as HTMLSelectElement | null;
    const endpointInput = document.getElementById('ask-endpoint') as HTMLInputElement | null;
    const apiKeyInput = document.getElementById('ask-apikey') as HTMLInputElement | null;
    const modelInput = document.getElementById('ask-model') as HTMLInputElement | null;

    if (!askBtn || !askPanel || !askClose || !askInput || !askSubmit || !askResponse) {
      console.warn('AskPanel: DOM elements missing, skipping init');
      return;
    }

    // Populate settings from saved config.
    if (backendSel) backendSel.value = this.config.backend;
    if (endpointInput) endpointInput.value = this.config.endpoint;
    if (apiKeyInput) apiKeyInput.value = this.config.apiKey;
    if (modelInput) modelInput.value = this.config.model;

    const saveFromUi = () => {
      if (backendSel) this.config.backend = backendSel.value as Backend;
      if (endpointInput) this.config.endpoint = endpointInput.value.trim();
      if (apiKeyInput) this.config.apiKey = apiKeyInput.value;
      if (modelInput) this.config.model = modelInput.value.trim();
      this.saveConfig();
    };
    for (const el of [backendSel, endpointInput, apiKeyInput, modelInput]) {
      el?.addEventListener('change', saveFromUi);
      el?.addEventListener('input', saveFromUi);
    }

    // When switching backend, swap defaults so the user doesn't have to
    // hand-rewrite URL + model names.
    backendSel?.addEventListener('change', () => {
      const newBackend = backendSel.value as Backend;
      if (newBackend === 'anthropic' && endpointInput && !endpointInput.value.includes('anthropic')) {
        endpointInput.value = 'https://api.anthropic.com/v1/messages';
        if (modelInput && !modelInput.value.startsWith('claude-')) {
          modelInput.value = 'claude-haiku-4-5-20251001';
        }
      } else if (newBackend === 'openai' && endpointInput && endpointInput.value.includes('anthropic')) {
        endpointInput.value = 'http://localhost:11434/v1/chat/completions';
        if (modelInput) modelInput.value = 'llama3.1:8b';
      }
      saveFromUi();
    });

    const open = () => {
      askPanel.style.display = 'block';
      if (askContext) askContext.textContent = this.formatContext(this.getState());
      setTimeout(() => askInput.focus(), 0);
    };
    const close = () => { askPanel.style.display = 'none'; };

    askBtn.addEventListener('click', () => {
      if (askPanel.style.display === 'none' || askPanel.style.display === '') open();
      else close();
    });
    askClose.addEventListener('click', close);

    const submit = async () => {
      const question = askInput.value.trim();
      if (!question) return;
      if (!this.config.apiKey && this.config.backend === 'anthropic') {
        askResponse.innerHTML = '<span style="color:#f88;">Enter an Anthropic API key in Settings below.</span>';
        return;
      }

      askResponse.innerHTML = '<em style="color:#888;">Thinking…</em>';
      (askSubmit as HTMLButtonElement).disabled = true;
      try {
        const answer = await this.ask(question);
        askResponse.textContent = answer;
      } catch (e: any) {
        askResponse.innerHTML = `<span style="color:#f88;">Error: ${escapeHtml(e?.message ?? String(e))}</span>`;
      } finally {
        (askSubmit as HTMLButtonElement).disabled = false;
      }
    };
    askSubmit.addEventListener('click', submit);
    askInput.addEventListener('keydown', (e: KeyboardEvent) => {
      // Cmd/Ctrl+Enter submits; bare Enter inserts a newline.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    });
  }

  private loadConfig(): Config {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch {}
    return { ...DEFAULT_CONFIG };
  }

  private saveConfig(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config)); } catch {}
  }

  private formatContext(s: SimState): string {
    const lines: string[] = [];
    lines.push(`Mode: ${s.mode === 'mode1' ? 'Two-Molecule Interaction' : 'Many-Molecule Box'}`);
    if (s.primarySpecies) lines.push(`Primary species: ${s.primarySpecies}`);
    if (s.count !== undefined) lines.push(`Molecule count: ${s.count}`);
    if (s.temperatureK !== undefined) lines.push(`Temperature: ${s.temperatureK.toFixed(0)} K`);
    if (s.waterModel) lines.push(`Water model: ${s.waterModel}`);
    if (s.experimentTitle) lines.push(`Active experiment: ${s.experimentTitle}`);
    if (s.iceSeedActive) lines.push(`Ice seed: active (${s.frozenCount ?? 0} frozen waters)`);
    if (s.periodic !== undefined) lines.push(`Boundaries: ${s.periodic ? 'periodic' : 'solid walls'}`);
    if (s.boxSizeA !== undefined) lines.push(`Box size: ${s.boxSizeA.toFixed(1)} Å`);
    if (s.timePs !== undefined) lines.push(`Simulation time: ${s.timePs.toFixed(1)} ps`);
    if (s.timestepFs !== undefined) lines.push(`Timestep: ${s.timestepFs.toFixed(1)} fs`);
    return lines.join('\n');
  }

  private async ask(question: string): Promise<string> {
    const context = this.formatContext(this.getState());
    const userContent = `Current simulation state:\n${context}\n\nStudent question: ${question}`;
    if (this.config.backend === 'anthropic') {
      return this.askAnthropic(userContent);
    }
    return this.askOpenAI(userContent);
  }

  private async askAnthropic(userContent: string): Promise<string> {
    const res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? '(empty response)';
  }

  private async askOpenAI(userContent: string): Promise<string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers['authorization'] = `Bearer ${this.config.apiKey}`;
    const res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '(empty response)';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
