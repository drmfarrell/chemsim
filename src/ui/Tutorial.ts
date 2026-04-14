/**
 * Guided tutorial / onboarding for students.
 * Shows step-by-step instructions overlaid on the simulation.
 */

interface TutorialStep {
  title: string;
  text: string;
  highlight?: string; // CSS selector of element to highlight
  action?: string;    // What the student needs to do to proceed
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Welcome to ChemSim!',
    text: 'This simulator lets you explore how molecules interact through their electrostatic forces. Click "Next" to begin the tour.',
  },
  {
    title: 'Two Molecules',
    text: 'You see two water molecules. The colored clouds around them show the electrostatic potential: red regions are electron-rich (negative), blue regions are electron-poor (positive).',
    highlight: 'canvas',
  },
  {
    title: 'Drag to Interact',
    text: 'Click and drag the right molecule toward the left one. Watch how the energy readout changes and the clouds deform as the molecules get closer.',
    highlight: '#energy-display',
    action: 'drag',
  },
  {
    title: 'Orientation Matters',
    text: 'Hold Shift and drag on the right molecule to rotate it. Notice how the energy changes depending on orientation. The most favorable alignment is when a red region faces a blue region.',
    action: 'rotate',
  },
  {
    title: 'Energy Readout',
    text: 'The energy panel shows the total interaction energy. Green (negative) means attractive, red (positive) means repulsive. The Coulomb and Lennard-Jones contributions are shown separately.',
    highlight: '#energy-display',
  },
  {
    title: 'Snap to Optimal',
    text: 'Click "Snap to Optimal" to automatically find the lowest-energy position and orientation. For water, this is the hydrogen-bonding geometry.',
    highlight: '#snap-optimal',
    action: 'snap',
  },
  {
    title: 'Try Different Molecules',
    text: 'Use the dropdowns to select different molecule pairs. Try comparing water-water with methane-methane to see why water is liquid at room temperature while methane is a gas.',
    highlight: '#molecule-a-selector',
  },
  {
    title: 'View Modes',
    text: 'Toggle between Ball+Stick, Space Fill, and Cloud Only views to see the molecules differently. You can also turn clouds on/off.',
    highlight: '.toggle-row',
  },
  {
    title: 'Box Mode',
    text: 'Switch to "Many-Molecule Box" mode to see many molecules interacting at once. Adjust temperature and watch phase transitions!',
    highlight: '#mode-selector',
  },
  {
    title: "You're Ready!",
    text: 'Explore on your own. Try the pre-set experiments in the menu for guided investigations. Have fun discovering intermolecular forces!',
  },
];

export class Tutorial {
  private overlay: HTMLElement;
  private currentStep = 0;
  private isActive = false;
  private onComplete: (() => void) | null = null;

  constructor() {
    this.overlay = this.createOverlay();
    document.body.appendChild(this.overlay);
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'tutorial-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.5); z-index: 1000; display: none;
      pointer-events: auto;
    `;

    const card = document.createElement('div');
    card.id = 'tutorial-card';
    card.style.cssText = `
      position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
      background: rgba(20, 25, 45, 0.95); backdrop-filter: blur(12px);
      border-radius: 16px; padding: 24px 32px; color: #e0e0e0;
      max-width: 480px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      border: 1px solid rgba(80, 140, 255, 0.3);
    `;

    card.innerHTML = `
      <h3 id="tutorial-title" style="color: #fff; margin-bottom: 8px; font-size: 18px;"></h3>
      <p id="tutorial-text" style="line-height: 1.6; margin-bottom: 16px; font-size: 14px;"></p>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span id="tutorial-progress" style="font-size: 12px; color: #888;"></span>
        <div>
          <button id="tutorial-skip" style="
            background: transparent; border: 1px solid rgba(255,255,255,0.2);
            color: #aaa; padding: 8px 16px; border-radius: 6px; cursor: pointer;
            margin-right: 8px; font-size: 13px;
          ">Skip</button>
          <button id="tutorial-next" style="
            background: rgba(80, 140, 255, 0.5); border: 1px solid rgba(80, 140, 255, 0.7);
            color: #fff; padding: 8px 20px; border-radius: 6px; cursor: pointer;
            font-size: 13px;
          ">Next</button>
        </div>
      </div>
    `;

    overlay.appendChild(card);

    // Event listeners
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        // Click on backdrop area doesn't dismiss (let interactions through)
      }
    });

    return overlay;
  }

  public start(onComplete?: () => void): void {
    this.currentStep = 0;
    this.isActive = true;
    this.onComplete = onComplete || null;
    this.overlay.style.display = 'block';
    this.showStep();

    const nextBtn = document.getElementById('tutorial-next')!;
    const skipBtn = document.getElementById('tutorial-skip')!;

    nextBtn.onclick = () => this.nextStep();
    skipBtn.onclick = () => this.end();
  }

  private showStep(): void {
    const step = TUTORIAL_STEPS[this.currentStep];

    const title = document.getElementById('tutorial-title')!;
    const text = document.getElementById('tutorial-text')!;
    const progress = document.getElementById('tutorial-progress')!;
    const nextBtn = document.getElementById('tutorial-next')!;

    title.textContent = step.title;
    text.textContent = step.text;
    progress.textContent = `${this.currentStep + 1} / ${TUTORIAL_STEPS.length}`;
    nextBtn.textContent = this.currentStep === TUTORIAL_STEPS.length - 1 ? 'Finish' : 'Next';
  }

  private nextStep(): void {
    this.currentStep++;
    if (this.currentStep >= TUTORIAL_STEPS.length) {
      this.end();
    } else {
      this.showStep();
    }
  }

  public end(): void {
    this.isActive = false;
    this.overlay.style.display = 'none';
    if (this.onComplete) this.onComplete();
  }

  public isRunning(): boolean {
    return this.isActive;
  }
}
