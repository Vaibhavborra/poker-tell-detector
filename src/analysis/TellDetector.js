// Singleton tell detector — feed it face frames, record player actions, get patterns

const MIN_SAMPLES = 5; // per action category before reporting a tell

class TellDetector {
  constructor() {
    this.frames       = [];   // rolling ~30s of biometric frames
    this.blinkEvents  = [];   // timestamps of each detected blink
    this.lastBlink    = false;
    this.actionLog    = [];   // { action, t, outcome, metrics }
    this.baselineScale = null;
    this.lastPos      = null;
    this.motionBuf    = [];
  }

  // Called each video frame from CameraOverlay
  addFrame(blendshapes, landmarks, t = Date.now()) {
    if (!blendshapes?.length || !landmarks?.length) return null;

    const bs = {};
    blendshapes[0].categories.forEach(c => { bs[c.categoryName] = c.score; });
    const lm = landmarks[0];

    // ── Blink detection (rising edge) ────────────────────────────────────
    const eyeBlink = ((bs.eyeBlinkLeft || 0) + (bs.eyeBlinkRight || 0)) / 2;
    if (eyeBlink > 0.38 && !this.lastBlink) this.blinkEvents.push(t);
    this.lastBlink = eyeBlink > 0.38;
    this.blinkEvents = this.blinkEvents.filter(e => t - e < 60000); // keep last 60s

    // ── Face scale / lean-forward ─────────────────────────────────────────
    let leanForward = 0;
    if (lm[234] && lm[454]) {
      const dx = lm[234].x - lm[454].x;
      const dy = lm[234].y - lm[454].y;
      const scale = Math.sqrt(dx * dx + dy * dy);
      if (!this.baselineScale) this.baselineScale = scale;
      // Positive = face got bigger = leaning forward
      leanForward = Math.max(0, Math.min(1, (scale - this.baselineScale) / (this.baselineScale * 0.25)));
    }

    // ── Head motion / stillness ───────────────────────────────────────────
    let headMotion = 0;
    if (lm[1]) {
      const pos = { x: lm[1].x, y: lm[1].y };
      if (this.lastPos) {
        const dx = pos.x - this.lastPos.x;
        const dy = pos.y - this.lastPos.y;
        headMotion = Math.sqrt(dx * dx + dy * dy);
      }
      this.lastPos = pos;
    }
    this.motionBuf.push(headMotion);
    if (this.motionBuf.length > 45) this.motionBuf.shift();
    const avgMotion = this.motionBuf.reduce((a, b) => a + b, 0) / (this.motionBuf.length || 1);
    // headFreeze: 1 = totally still, 0 = lots of movement
    const headFreeze = Math.max(0, Math.min(1, 1 - avgMotion * 400));

    const frame = {
      t,
      eyeBlink,
      browRaise:   ((bs.browInnerUp || 0) + (bs.browOuterUpLeft || 0) + (bs.browOuterUpRight || 0)) / 3,
      smile:       ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2,
      lipPress:    ((bs.mouthPressLeft || 0) + (bs.mouthPressRight || 0)) / 2,
      noseSneer:   ((bs.noseSneerLeft || 0) + (bs.noseSneerRight || 0)) / 2,
      eyeWide:     ((bs.eyeWideLeft || 0) + (bs.eyeWideRight || 0)) / 2,
      browFurrow:  ((bs.browDownLeft || 0) + (bs.browDownRight || 0)) / 2,
      cheekSquint: ((bs.cheekSquintLeft || 0) + (bs.cheekSquintRight || 0)) / 2,
      lipRoll:     ((bs.mouthRollLower || 0) + (bs.mouthRollUpper || 0)) / 2,
      jawOpen:     bs.jawOpen || 0,
      headFreeze,
      leanForward,
    };

    this.frames.push(frame);
    if (this.frames.length > 900) this.frames.shift(); // cap at ~30s @ 30fps

    return frame;
  }

  // Called from App.jsx when player takes an action
  recordAction(action) {
    const t = Date.now();
    const recent = this.frames.filter(f => t - f.t < 2500);
    if (recent.length < 4) return; // not enough face data

    const avg = key => recent.reduce((s, f) => s + (f[key] || 0), 0) / recent.length;

    // Blink rate: blinks per minute over last 30s
    const blinksRecent = this.blinkEvents.filter(e => t - e < 30000).length;
    const blinkRate = blinksRecent * 2; // ×2 → per-minute estimate

    this.actionLog.push({
      action, t, outcome: null,
      metrics: {
        blinkRate,
        browRaise:   avg('browRaise'),
        smile:       avg('smile'),
        lipPress:    avg('lipPress'),
        noseSneer:   avg('noseSneer'),
        eyeWide:     avg('eyeWide'),
        browFurrow:  avg('browFurrow'),
        cheekSquint: avg('cheekSquint'),
        lipRoll:     avg('lipRoll'),
        headFreeze:  avg('headFreeze'),
        leanForward: avg('leanForward'),
      },
    });

    if (this.actionLog.length > 300) this.actionLog.shift();
  }

  // Call after hand ends with 'player'|'bot'|'split'
  updateOutcome(winner) {
    for (let i = this.actionLog.length - 1; i >= 0; i--) {
      if (!this.actionLog[i].outcome) { this.actionLog[i].outcome = winner; break; }
    }
  }

  // Generate tell report for the panel
  getReport() {
    const betting = this.actionLog.filter(s => s.action === 'bet' || s.action === 'raise');
    const passive = this.actionLog.filter(s => s.action === 'check' || s.action === 'call');
    const folds   = this.actionLog.filter(s => s.action === 'fold');

    const _mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const _std  = (arr, m) => arr.length < 2
      ? 0
      : Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
    const _d    = (a, b) => {
      const ma = _mean(a); const mb = _mean(b);
      const s = Math.sqrt((_std(a, ma) ** 2 + _std(b, mb) ** 2) / 2) || 0.001;
      return (ma - mb) / s;
    };
    const _vals = (group, metric) => group.map(s => s.metrics[metric] || 0);

    const TELLS = [
      {
        id: 'blink', metric: 'blinkRate',
        name: 'Blink Rate',
        icon: '👁',
        descHigh: 'Blinks faster when betting — stress signal, often seen during bluffs',
        descLow:  'Blinks slower when betting — suppressed tells, controlled under pressure',
      },
      {
        id: 'brow', metric: 'browRaise',
        name: 'Eyebrow Flash',
        icon: '⬆',
        descHigh: 'Eyebrows flash up when aggressive — excitement leaking on strong hands',
        descLow:  'Flat brows when betting — practiced neutral face',
      },
      {
        id: 'smile', metric: 'smile',
        name: 'Micro-Smile',
        icon: '🙂',
        descHigh: 'Brief smile when betting — hard to hide happiness on strong hands',
        descLow:  'Suppresses smile when passive — controls expression well',
      },
      {
        id: 'lip', metric: 'lipPress',
        name: 'Lip Compression',
        icon: '😬',
        descHigh: 'Presses lips together when betting — classic anxiety / bluff response',
        descLow:  'Relaxed mouth when betting — comfortable, possibly strong hand',
      },
      {
        id: 'nose', metric: 'noseSneer',
        name: 'Nostril Flare',
        icon: '👃',
        descHigh: 'Nostrils flare when aggressive — involuntary adrenaline response',
        descLow:  'No nostril response — well-controlled autonomic reactions',
      },
      {
        id: 'freeze', metric: 'headFreeze',
        name: 'Sudden Stillness',
        icon: '🧊',
        descHigh: 'Freezes up before betting — "rabbit in headlights" bluff tell',
        descLow:  'Stays relaxed and loose — natural movement even under pressure',
      },
      {
        id: 'lean', metric: 'leanForward',
        name: 'Forward Lean',
        icon: '⬆',
        descHigh: 'Leans in when betting — high engagement, often a monster hand',
        descLow:  'Sits back when betting — detachment, sometimes a big bluff',
      },
      {
        id: 'eyes', metric: 'eyeWide',
        name: 'Eye Widening',
        icon: '😲',
        descHigh: 'Eyes widen when betting — excitement / surprise on big hands',
        descLow:  'Eyes stay normal — maintains poker face well',
      },
      {
        id: 'furrow', metric: 'browFurrow',
        name: 'Brow Furrow',
        icon: '😤',
        descHigh: 'Brow furrows when passive — concentration / concern about the hand',
        descLow:  'Unfurrowed when passive — relaxed, possibly stronger than it looks',
        compareGroup: 'passive', // compare passive vs betting for this one
      },
      {
        id: 'squint', metric: 'cheekSquint',
        name: 'Cheek Squint',
        icon: '🤨',
        descHigh: 'Squints during passive actions — reading the board hard, uncertainty',
        descLow:  'Relaxed eyes when checking — comfortable with marginal spots',
        compareGroup: 'passive',
      },
      {
        id: 'liproll', metric: 'lipRoll',
        name: 'Lip Roll (Dry Swallow)',
        icon: '💧',
        descHigh: 'Rolls lips when betting — dry-mouth stress response, classic bluff signal',
        descLow:  'No lip roll detected when betting',
      },
    ];

    const totalSamples = this.actionLog.length;

    return {
      totalSamples,
      bettingSamples: betting.length,
      passiveSamples: passive.length,
      foldSamples:    folds.length,
      tells: TELLS.map(tell => {
        // default: compare betting (high) vs passive (low)
        // some tells: compare passive vs betting
        const grpA = tell.compareGroup === 'passive' ? passive : betting;
        const grpB = tell.compareGroup === 'passive' ? betting  : passive;
        const labA = tell.compareGroup === 'passive' ? 'passive' : 'betting';
        const labB = tell.compareGroup === 'passive' ? 'betting' : 'passive';

        const valsA = _vals(grpA, tell.metric);
        const valsB = _vals(grpB, tell.metric);

        const hasData = grpA.length >= MIN_SAMPLES && grpB.length >= MIN_SAMPLES;

        if (!hasData) {
          return {
            ...tell, hasData: false,
            samplesNeeded: MIN_SAMPLES - Math.min(grpA.length, grpB.length),
            aSamples: grpA.length, bSamples: grpB.length,
          };
        }

        const d = _d(valsA, valsB);
        const absD = Math.abs(d);
        const strength = absD > 0.8 ? 'strong' : absD > 0.4 ? 'moderate' : absD > 0.15 ? 'weak' : 'none';

        return {
          ...tell, hasData: true, d, strength,
          description: d > 0.15 ? tell.descHigh : tell.descLow,
          aSamples: grpA.length, bSamples: grpB.length,
        };
      })
        .filter(t => !t.hasData || t.strength !== 'none')
        .sort((a, b) => {
          if (!a.hasData && !b.hasData) return 0;
          if (!a.hasData) return 1;
          if (!b.hasData) return -1;
          return Math.abs(b.d) - Math.abs(a.d);
        }),
    };
  }

  // Latest metrics for live indicator inside camera
  getCurrent() {
    const recent = this.frames.slice(-8);
    if (!recent.length) return null;
    const avg = k => recent.reduce((s, f) => s + (f[k] || 0), 0) / recent.length;
    return {
      blink:     avg('eyeBlink'),
      browRaise: avg('browRaise'),
      smile:     avg('smile'),
      lipPress:  avg('lipPress'),
    };
  }
}

export const tellDetector = new TellDetector();
