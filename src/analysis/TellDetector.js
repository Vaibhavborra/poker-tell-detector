// ─── Tell Detector ─────────────────────────────────────────────────────────
// Tracks facial biometrics per player action and finds patterns.
// Three comparison axes:
//   1. Aggressive (bet/raise) vs Passive (check/call)   — are you acting differently when you bet?
//   2. Value (bet/raise → won)  vs Bluff (bet/raise → lost) — does your face differ on real hands?
//   3. Strong passive (check/call → won) vs Weak passive (check/call → lost) — slow-play signals?

const MIN_SAMPLES = 5;

class TellDetector {
  constructor() {
    this.frames        = [];
    this.blinkEvents   = [];
    this.lastBlink     = false;
    this.actionLog     = [];       // { action, t, handId, outcome, metrics }
    this.currentHandId = 0;
    this.baselineScale = null;
    this.lastPos       = null;
    this.lastTilt      = null;
    this.motionBuf     = [];
    this.tiltBuf       = [];
  }

  // ── Frame ingestion ────────────────────────────────────────────────────────
  addFrame(blendshapes, landmarks, t = Date.now()) {
    if (!blendshapes?.length || !landmarks?.length) return null;

    const bs = {};
    blendshapes[0].categories.forEach(c => { bs[c.categoryName] = c.score; });
    const lm = landmarks[0];

    // Blink rising-edge detection
    const eyeBlink = ((bs.eyeBlinkLeft || 0) + (bs.eyeBlinkRight || 0)) / 2;
    if (eyeBlink > 0.38 && !this.lastBlink) this.blinkEvents.push(t);
    this.lastBlink = eyeBlink > 0.38;
    this.blinkEvents = this.blinkEvents.filter(e => t - e < 60000);

    // Face scale → lean forward
    let leanForward = 0;
    if (lm[234] && lm[454]) {
      const dx = lm[234].x - lm[454].x;
      const dy = lm[234].y - lm[454].y;
      const scale = Math.sqrt(dx * dx + dy * dy);
      if (!this.baselineScale) this.baselineScale = scale;
      leanForward = Math.max(0, Math.min(1, (scale - this.baselineScale) / (this.baselineScale * 0.25)));
    }

    // Head motion → freeze detection
    let headMotion = 0;
    if (lm[1]) {
      if (this.lastPos) {
        const dx = lm[1].x - this.lastPos.x;
        const dy = lm[1].y - this.lastPos.y;
        headMotion = Math.sqrt(dx * dx + dy * dy);
      }
      this.lastPos = { x: lm[1].x, y: lm[1].y };
    }
    this.motionBuf.push(headMotion);
    if (this.motionBuf.length > 45) this.motionBuf.shift();
    const avgMotion = this.motionBuf.reduce((a, b) => a + b, 0) / (this.motionBuf.length || 1);
    const headFreeze = Math.max(0, Math.min(1, 1 - avgMotion * 400));

    // Head tilt (roll) — left/right lean
    let headTilt = 0;
    if (lm[10] && lm[152]) {
      const tilt = Math.atan2(lm[152].y - lm[10].y, lm[152].x - lm[10].x);
      if (this.lastTilt !== null) headTilt = Math.abs(tilt - this.lastTilt);
      this.lastTilt = tilt;
    }
    this.tiltBuf.push(headTilt);
    if (this.tiltBuf.length > 30) this.tiltBuf.shift();
    const avgTilt = this.tiltBuf.reduce((a, b) => a + b, 0) / (this.tiltBuf.length || 1);

    // Eye look direction — looking away vs direct gaze
    const eyeLookAway = (
      (bs.eyeLookOutLeft  || 0) + (bs.eyeLookOutRight || 0) +
      (bs.eyeLookDownLeft || 0) + (bs.eyeLookDownRight || 0)
    ) / 4;

    const frame = {
      t,
      // Eyes
      eyeBlink,
      eyeWide:       ((bs.eyeWideLeft    || 0) + (bs.eyeWideRight    || 0)) / 2,
      eyeSquint:     ((bs.eyeSquintLeft  || 0) + (bs.eyeSquintRight  || 0)) / 2,
      eyeLookAway,
      eyeLookUp:     ((bs.eyeLookUpLeft  || 0) + (bs.eyeLookUpRight  || 0)) / 2,
      cheekSquint:   ((bs.cheekSquintLeft|| 0) + (bs.cheekSquintRight|| 0)) / 2,
      cheekPuff:     ((bs.cheekPuffLeft  || 0) + (bs.cheekPuffRight  || 0)) / 2,
      // Brows
      browRaise:     ((bs.browInnerUp    || 0) + (bs.browOuterUpLeft  || 0) + (bs.browOuterUpRight || 0)) / 3,
      browInnerUp:    bs.browInnerUp    || 0,    // worry wrinkle specifically
      browFurrow:    ((bs.browDownLeft   || 0) + (bs.browDownRight   || 0)) / 2,
      // Mouth
      smile:         ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2,
      mouthFrown:    ((bs.mouthFrownLeft || 0) + (bs.mouthFrownRight || 0)) / 2,
      lipPress:      ((bs.mouthPressLeft || 0) + (bs.mouthPressRight || 0)) / 2,
      lipRoll:       ((bs.mouthRollLower || 0) + (bs.mouthRollUpper  || 0)) / 2,
      mouthPucker:    bs.mouthPucker    || 0,
      mouthFunnel:    bs.mouthFunnel    || 0,
      mouthDimple:   ((bs.mouthDimpleLeft|| 0) + (bs.mouthDimpleRight|| 0)) / 2,
      mouthStretch:  ((bs.mouthStretchLeft||0) + (bs.mouthStretchRight||0)) / 2,
      mouthShrugLower:bs.mouthShrugLower|| 0,
      jawOpen:        bs.jawOpen        || 0,
      jawForward:     bs.jawForward     || 0,
      // Nose
      noseSneer:     ((bs.noseSneerLeft  || 0) + (bs.noseSneerRight  || 0)) / 2,
      // Head
      headFreeze,
      leanForward,
      headTiltMotion: avgTilt,
    };

    this.frames.push(frame);
    if (this.frames.length > 900) this.frames.shift();
    return frame;
  }

  // ── Action recording ───────────────────────────────────────────────────────
  // amount = chip amount (for bet/raise), pot = pot size before the action
  recordAction(action, amount = 0, pot = 0) {
    const t = Date.now();
    const recent = this.frames.filter(f => t - f.t < 3000);
    if (recent.length < 3) return;

    const avg = k => recent.reduce((s, f) => s + (f[k] || 0), 0) / recent.length;

    const blinksRecent = this.blinkEvents.filter(e => t - e < 30000).length;
    const blinkRate = blinksRecent * 2;

    // Bet sizing classification (0–1 scale: 0=tiny, 1=overbet)
    // pot=0 on check/fold/call — sizing is irrelevant for those
    const betRatio = (action === 'bet' || action === 'raise') && pot > 0
      ? Math.min(2, amount / pot)   // capped at 2x pot
      : -1;                          // -1 = not a bet action

    // isLargeBet: true if bet > 70% of pot (polarized sizing, more often a bluff or monster)
    const isLargeBet  = betRatio >= 0.70;
    // isSmallBet: true if bet < 35% of pot (blocking/thin value sizing)
    const isSmallBet  = betRatio >= 0 && betRatio < 0.35;

    this.actionLog.push({
      action,
      t,
      handId:   this.currentHandId,
      outcome:  null,
      betRatio,       // pot-relative size (-1 if not a bet)
      isLargeBet,
      isSmallBet,
      metrics: {
        blinkRate,
        eyeBlink:        avg('eyeBlink'),
        eyeWide:         avg('eyeWide'),
        eyeSquint:       avg('eyeSquint'),
        eyeLookAway:     avg('eyeLookAway'),
        eyeLookUp:       avg('eyeLookUp'),
        cheekSquint:     avg('cheekSquint'),
        cheekPuff:       avg('cheekPuff'),
        browRaise:       avg('browRaise'),
        browInnerUp:     avg('browInnerUp'),
        browFurrow:      avg('browFurrow'),
        smile:           avg('smile'),
        mouthFrown:      avg('mouthFrown'),
        lipPress:        avg('lipPress'),
        lipRoll:         avg('lipRoll'),
        mouthPucker:     avg('mouthPucker'),
        mouthFunnel:     avg('mouthFunnel'),
        mouthDimple:     avg('mouthDimple'),
        mouthStretch:    avg('mouthStretch'),
        mouthShrugLower: avg('mouthShrugLower'),
        jawOpen:         avg('jawOpen'),
        jawForward:      avg('jawForward'),
        noseSneer:       avg('noseSneer'),
        headFreeze:      avg('headFreeze'),
        leanForward:     avg('leanForward'),
        headTiltMotion:  avg('headTiltMotion'),
      },
    });

    if (this.actionLog.length > 500) this.actionLog.shift();
  }

  // ── Outcome recording ──────────────────────────────────────────────────────
  // Call at hand end — marks ALL actions from this hand with the outcome
  updateOutcome(winner) {
    const hid = this.currentHandId;
    this.actionLog
      .filter(e => e.handId === hid && !e.outcome)
      .forEach(e => { e.outcome = winner; });
    this.currentHandId++;
  }

  // ── Stats helpers ──────────────────────────────────────────────────────────
  _mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
  _std(arr, m) {
    return arr.length < 2
      ? 0
      : Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
  }
  _cohensD(a, b) {
    const ma = this._mean(a); const mb = this._mean(b);
    const pooled = Math.sqrt((this._std(a, ma) ** 2 + this._std(b, mb) ** 2) / 2) || 0.001;
    return (ma - mb) / pooled;
  }
  _vals(group, metric) { return group.map(s => s.metrics[metric] || 0); }

  // ── Tell definitions ───────────────────────────────────────────────────────
  // Each tell has a comparison type:
  //   'agg_vs_pass'   — aggressive (bet/raise) vs passive (check/call)
  //   'value_vs_bluff'— bets that WON vs bets that LOST (requires outcomes)
  //   'strong_vs_weak'— any action that WON vs any action that LOST
  //   'fold_vs_stay'  — fold vs non-fold
  _getTells() {
    return [
      // ── AGGRESSIVE vs PASSIVE ─────────────────────────────────────────────
      {
        id: 'blink_agg', metric: 'blinkRate', type: 'agg_vs_pass',
        name: 'Blink Rate (Aggression)',
        icon: '👁', cat: 'Eyes',
        descHigh: 'Blinks significantly faster when betting/raising — elevated stress, common bluff signal',
        descLow:  'Blinks less when betting — controlled, may indicate calm confidence on strong hands',
      },
      {
        id: 'eyeWide_agg', metric: 'eyeWide', type: 'agg_vs_pass',
        name: 'Eye Widening (Aggression)',
        icon: '😲', cat: 'Eyes',
        descHigh: 'Eyes open wider when betting — adrenaline leak, often a strong hand tell',
        descLow:  'Eyes stay normal when betting — good emotional control',
      },
      {
        id: 'eyeSquint_agg', metric: 'eyeSquint', type: 'agg_vs_pass',
        name: 'Eye Squint (Aggression)',
        icon: '🤨', cat: 'Eyes',
        descHigh: 'Squints eyes when betting — tension, concentration, sometimes a bluff tell',
        descLow:  'Relaxed eyes when betting — comfortable with the decision',
      },
      {
        id: 'eyeAway_agg', metric: 'eyeLookAway', type: 'agg_vs_pass',
        name: 'Gaze Aversion (Aggression)',
        icon: '👀', cat: 'Eyes',
        descHigh: 'Looks away more when betting — avoiding eye contact after big bets, classic bluff tell',
        descLow:  'Maintains gaze when betting — confident, often a stronger hand',
      },
      {
        id: 'browRaise_agg', metric: 'browRaise', type: 'agg_vs_pass',
        name: 'Eyebrow Flash (Aggression)',
        icon: '⬆️', cat: 'Brows',
        descHigh: 'Eyebrows flash up when betting — excitement leaking through, often a strong hand',
        descLow:  'Flat brows when betting — practiced neutral face under pressure',
      },
      {
        id: 'browInner_agg', metric: 'browInnerUp', type: 'agg_vs_pass',
        name: 'Worry Wrinkle (Aggression)',
        icon: '😟', cat: 'Brows',
        descHigh: 'Inner brows raise when betting — involuntary anxiety response, often a bluff',
        descLow:  'No worry signal when betting — relaxed and confident',
      },
      {
        id: 'browFurrow_pass', metric: 'browFurrow', type: 'pass_vs_agg',
        name: 'Brow Furrow (Passive)',
        icon: '😤', cat: 'Brows',
        descHigh: 'Brow furrows more when checking/calling — concerned about hand strength',
        descLow:  'Relaxed brow when passive — comfortable with marginal spots',
      },
      {
        id: 'smile_agg', metric: 'smile', type: 'agg_vs_pass',
        name: 'Micro-Smile (Aggression)',
        icon: '🙂', cat: 'Mouth',
        descHigh: 'Suppressed smile when betting — happiness leaking through on strong hands',
        descLow:  'No smile change — well controlled expression',
      },
      {
        id: 'dimple_agg', metric: 'mouthDimple', type: 'agg_vs_pass',
        name: 'Mouth Dimple (Aggression)',
        icon: '😊', cat: 'Mouth',
        descHigh: 'Mouth dimples subtly when betting — suppressed grin on good hands',
        descLow:  'No dimpling when betting — neutral expression maintained',
      },
      {
        id: 'lipPress_agg', metric: 'lipPress', type: 'agg_vs_pass',
        name: 'Lip Compression (Aggression)',
        icon: '😬', cat: 'Mouth',
        descHigh: 'Presses lips together when betting — classic anxiety/bluff response',
        descLow:  'Relaxed lips when betting — comfortable, likely a strong hand',
      },
      {
        id: 'lipRoll_agg', metric: 'lipRoll', type: 'agg_vs_pass',
        name: 'Lip Roll / Dry Mouth',
        icon: '💧', cat: 'Mouth',
        descHigh: 'Rolls lips before betting — dry-mouth stress response, classic bluff signal',
        descLow:  'No lip rolling when betting — physiologically calm',
      },
      {
        id: 'pucker_agg', metric: 'mouthPucker', type: 'agg_vs_pass',
        name: 'Lip Pucker (Aggression)',
        icon: '😗', cat: 'Mouth',
        descHigh: 'Puckers lips when betting — tension held in the face, often a bluff tell',
        descLow:  'No puckering when betting',
      },
      {
        id: 'funnel_agg', metric: 'mouthFunnel', type: 'agg_vs_pass',
        name: 'Mouth Funnel (Aggression)',
        icon: '😮', cat: 'Mouth',
        descHigh: 'Mouth funnels (tenses into an O) when betting — held breath, bluff under pressure',
        descLow:  'No mouth funnel — breathing normally when betting',
      },
      {
        id: 'frown_pass', metric: 'mouthFrown', type: 'pass_vs_agg',
        name: 'Mouth Frown (Passive)',
        icon: '🙁', cat: 'Mouth',
        descHigh: 'Frowns when checking/calling — displeasure with hand strength or situation',
        descLow:  'Neutral mouth when passive — comfortable with the spot',
      },
      {
        id: 'jawOpen_agg', metric: 'jawOpen', type: 'agg_vs_pass',
        name: 'Jaw Drop (Aggression)',
        icon: '😦', cat: 'Mouth',
        descHigh: 'Jaw slightly opens when betting — surprise/shock at own hand or board',
        descLow:  'Jaw stays closed when betting',
      },
      {
        id: 'jawFwd_agg', metric: 'jawForward', type: 'agg_vs_pass',
        name: 'Jaw Thrust (Aggression)',
        icon: '😤', cat: 'Mouth',
        descHigh: 'Jaw juts forward when betting — assertive body language, often a strong hand',
        descLow:  'No jaw thrust when betting',
      },
      {
        id: 'nose_agg', metric: 'noseSneer', type: 'agg_vs_pass',
        name: 'Nostril Flare (Aggression)',
        icon: '👃', cat: 'Face',
        descHigh: 'Nostrils flare when betting — adrenaline spike, very hard to suppress',
        descLow:  'No nostril response — excellent physiological control',
      },
      {
        id: 'cheekPuff_agg', metric: 'cheekPuff', type: 'agg_vs_pass',
        name: 'Cheek Puff (Aggression)',
        icon: '🐡', cat: 'Face',
        descHigh: 'Puffs cheeks when betting — deep breath / sigh of relief, often a strong hand',
        descLow:  'No cheek puff when betting',
      },
      {
        id: 'freeze_agg', metric: 'headFreeze', type: 'agg_vs_pass',
        name: 'Head Freeze (Aggression)',
        icon: '🧊', cat: 'Head',
        descHigh: 'Goes completely still before betting — predator freeze, or scared bluff response',
        descLow:  'Natural head movement when betting — relaxed and confident',
      },
      {
        id: 'lean_agg', metric: 'leanForward', type: 'agg_vs_pass',
        name: 'Forward Lean (Aggression)',
        icon: '↗️', cat: 'Head',
        descHigh: 'Leans toward the screen when betting — high engagement, often a monster hand',
        descLow:  'Leans back when betting — disengaged, possibly a large bluff',
      },
      {
        id: 'tilt_agg', metric: 'headTiltMotion', type: 'agg_vs_pass',
        name: 'Head Tilt (Aggression)',
        icon: '↩️', cat: 'Head',
        descHigh: 'More head movement/tilting when betting — nervous energy leaking out',
        descLow:  'Stillness in head tilt when betting — controlled demeanor',
      },

      // ── VALUE vs BLUFF (bet/raise with outcome) ───────────────────────────
      {
        id: 'smile_value', metric: 'smile', type: 'value_vs_bluff',
        name: 'Smile — Value vs Bluff',
        icon: '😄', cat: 'Value/Bluff',
        descHigh: 'Smiles more on winning bets than losing ones — happiness leaks through on real hands',
        descLow:  'Same smile frequency on bluffs and value — strong emotional control',
      },
      {
        id: 'blink_value', metric: 'blinkRate', type: 'value_vs_bluff',
        name: 'Blink Rate — Value vs Bluff',
        icon: '👁', cat: 'Value/Bluff',
        descHigh: 'Blinks more on losing bets — elevated stress when bluffing vs value betting',
        descLow:  'Same blink rate whether bluffing or value betting — hard to read',
      },
      {
        id: 'lipPress_value', metric: 'lipPress', type: 'bluff_vs_value',
        name: 'Lip Press — Bluff vs Value',
        icon: '😬', cat: 'Value/Bluff',
        descHigh: 'Presses lips MORE on bluffs than value bets — anxiety leak when bluffing',
        descLow:  'Same lip response whether bluffing or not',
      },
      {
        id: 'eyeAway_value', metric: 'eyeLookAway', type: 'bluff_vs_value',
        name: 'Gaze Aversion — Bluff vs Value',
        icon: '👀', cat: 'Value/Bluff',
        descHigh: 'Looks away more on bluffs — classic eye contact avoidance when lying',
        descLow:  'Same gaze on bluffs and value bets — hard to exploit on this tell',
      },
      {
        id: 'freeze_value', metric: 'headFreeze', type: 'bluff_vs_value',
        name: 'Head Freeze — Bluff vs Value',
        icon: '🧊', cat: 'Value/Bluff',
        descHigh: 'Goes stiller on bluffs — "scared stiff" tell on big bluffs',
        descLow:  'Same movement on both — well calibrated',
      },
      {
        id: 'lean_value', metric: 'leanForward', type: 'value_vs_bluff',
        name: 'Lean Forward — Value vs Bluff',
        icon: '↗️', cat: 'Value/Bluff',
        descHigh: 'Leans in more on value bets — excited engagement with a strong hand',
        descLow:  'Same lean whether value or bluff — no body language tell here',
      },
      {
        id: 'browRaise_value', metric: 'browRaise', type: 'value_vs_bluff',
        name: 'Eyebrow Flash — Value vs Bluff',
        icon: '⬆️', cat: 'Value/Bluff',
        descHigh: 'Eyebrows flash higher on winning bets — excitement on real hands is visible',
        descLow:  'Same brow flash on both — controlled expression',
      },

      // ── STRONG HAND vs WEAK HAND (any action, by outcome) ────────────────
      {
        id: 'smile_strong', metric: 'smile', type: 'strong_vs_weak',
        name: 'Smile — Strong vs Weak Hand',
        icon: '😊', cat: 'Strong Hand',
        descHigh: 'Smiles more across ALL actions when holding a winning hand — good cards make you happier',
        descLow:  'Smile rate is the same regardless of hand strength — hard to read',
      },
      {
        id: 'eyeWide_strong', metric: 'eyeWide', type: 'strong_vs_weak',
        name: 'Eye Widening — Strong vs Weak Hand',
        icon: '😲', cat: 'Strong Hand',
        descHigh: 'Eyes widen on winning hands regardless of action — strong hand excitement',
        descLow:  'Eye width is consistent regardless of hand strength',
      },
      {
        id: 'browRaise_strong', metric: 'browRaise', type: 'strong_vs_weak',
        name: 'Eyebrow Flash — Strong vs Weak Hand',
        icon: '⬆️', cat: 'Strong Hand',
        descHigh: 'Brows raise higher on hands you win — eyebrow flash on good cards',
        descLow:  'Brows stay flat regardless of hand strength — good control',
      },
      {
        id: 'lean_strong', metric: 'leanForward', type: 'strong_vs_weak',
        name: 'Forward Lean — Strong vs Weak Hand',
        icon: '↗️', cat: 'Strong Hand',
        descHigh: 'Leans forward more on winning hands — body drawn toward the pot unconsciously',
        descLow:  'Same posture regardless of hand strength',
      },
      {
        id: 'freeze_strong', metric: 'headFreeze', type: 'weak_vs_strong',
        name: 'Head Freeze — Weak vs Strong Hand',
        icon: '🧊', cat: 'Strong Hand',
        descHigh: 'Goes stiller on losing hands — discomfort and guardedness when holding air',
        descLow:  'Movement is the same regardless of hand strength',
      },
      {
        id: 'noseSneer_strong', metric: 'noseSneer', type: 'strong_vs_weak',
        name: 'Nostril Flare — Strong vs Weak Hand',
        icon: '👃', cat: 'Strong Hand',
        descHigh: 'Nostrils flare on winning hands — adrenaline from genuine excitement',
        descLow:  'Same nostril response regardless of cards',
      },

      // ── FOLD vs STAY ──────────────────────────────────────────────────────
      {
        id: 'lipPress_fold', metric: 'lipPress', type: 'fold_vs_stay',
        name: 'Lip Press — Before Folding',
        icon: '😬', cat: 'Folding',
        descHigh: 'Presses lips more when folding — anxiety and reluctance before giving up the hand',
        descLow:  'Same lip response when folding vs staying',
      },
      {
        id: 'eyeAway_fold', metric: 'eyeLookAway', type: 'fold_vs_stay',
        name: 'Gaze Aversion — Before Folding',
        icon: '👀', cat: 'Folding',
        descHigh: 'Looks away more before folding — disengaging before giving up',
        descLow:  'Same gaze when folding vs staying in hand',
      },

      // ── BET SIZING TELLS ──────────────────────────────────────────────────
      // Large bets (>70% pot) vs small bets (<35% pot) — sizing signals intent
      {
        id: 'freeze_overbet', metric: 'headFreeze', type: 'large_vs_small',
        name: 'Head Freeze — Large vs Small Bets',
        icon: '🧊', cat: 'Bet Sizing',
        descHigh: 'Goes stiller on large overbets than small bets — tension when committing big chips, often a bluff tell',
        descLow:  'Same composure on big and small bets — good at hiding sizing intent',
      },
      {
        id: 'smile_overbet', metric: 'smile', type: 'small_vs_large',
        name: 'Micro-Smile — Small vs Large Bets',
        icon: '🙂', cat: 'Bet Sizing',
        descHigh: 'Smiles more on small bets than large — happiness leaks on thin-value hands, tighter on bluffs',
        descLow:  'Same expression regardless of bet size',
      },
      {
        id: 'lipPress_overbet', metric: 'lipPress', type: 'large_vs_small',
        name: 'Lip Compression — Large vs Small Bets',
        icon: '😬', cat: 'Bet Sizing',
        descHigh: 'Lip compression increases on large bets — anxiety when putting in big chips, classic bluff overbet tell',
        descLow:  'Relaxed lips on both big and small bets',
      },
      {
        id: 'eyeAway_overbet', metric: 'eyeLookAway', type: 'large_vs_small',
        name: 'Gaze Aversion — Large vs Small Bets',
        icon: '👀', cat: 'Bet Sizing',
        descHigh: 'Looks away more on large bets — avoiding eye contact when committing a lot, often bluffing',
        descLow:  'Maintains gaze on big bets — confident with large sizing',
      },
      {
        id: 'lean_overbet', metric: 'leanForward', type: 'small_vs_large',
        name: 'Forward Lean — Small vs Large Bets',
        icon: '↗️', cat: 'Bet Sizing',
        descHigh: 'Leans forward more on small bets — engaged with thin-value hands; backs off on overbets',
        descLow:  'Same posture on all bet sizes',
      },
    ];
  }

  // ── Report generation ──────────────────────────────────────────────────────
  getReport() {
    // Use ALL logged actions (with or without outcome) for sizing-based tells
    // Use only resolved actions for outcome-based tells
    const allResolved = this.actionLog.filter(e => e.outcome !== null);
    const allActions  = this.actionLog; // includes unresolved (current hand)

    const agg       = allActions.filter(e => e.action === 'bet' || e.action === 'raise');
    const pass      = allActions.filter(e => e.action === 'check' || e.action === 'call');
    const folds     = allActions.filter(e => e.action === 'fold');
    const stay      = allActions.filter(e => e.action !== 'fold');

    // Outcome-based groups (only resolved hands)
    const strong    = allResolved.filter(e => e.outcome === 'player');
    const weak      = allResolved.filter(e => e.outcome === 'bot' || e.outcome === 'split');
    const aggRes    = allResolved.filter(e => e.action === 'bet' || e.action === 'raise');
    const valueBets = aggRes.filter(e => e.outcome === 'player');
    const lostBets  = aggRes.filter(e => e.outcome !== 'player');

    // Bet-sizing groups (based on pot ratio, no outcome needed)
    const largeBets = agg.filter(e => e.isLargeBet === true);
    const smallBets = agg.filter(e => e.isSmallBet === true);

    // Sizing stats for display
    const avgBetRatio = agg.length
      ? agg.filter(e => e.betRatio >= 0).reduce((s, e) => s + e.betRatio, 0) / agg.filter(e => e.betRatio >= 0).length
      : null;
    const overbetCount = largeBets.length;
    const smallBetCount = smallBets.length;

    const tells = this._getTells().map(tell => {
      let grpA, grpB;
      switch (tell.type) {
        case 'agg_vs_pass':    grpA = agg;       grpB = pass;     break;
        case 'pass_vs_agg':    grpA = pass;      grpB = agg;      break;
        case 'value_vs_bluff': grpA = valueBets; grpB = lostBets; break;
        case 'bluff_vs_value': grpA = lostBets;  grpB = valueBets;break;
        case 'strong_vs_weak': grpA = strong;    grpB = weak;     break;
        case 'weak_vs_strong': grpA = weak;      grpB = strong;   break;
        case 'fold_vs_stay':   grpA = folds;     grpB = stay;     break;
        case 'large_vs_small': grpA = largeBets; grpB = smallBets;break;
        case 'small_vs_large': grpA = smallBets; grpB = largeBets;break;
        default:               grpA = agg;       grpB = pass;
      }

      const hasData = grpA.length >= MIN_SAMPLES && grpB.length >= MIN_SAMPLES;
      if (!hasData) {
        return {
          ...tell, hasData: false,
          samplesNeeded: MIN_SAMPLES - Math.min(grpA.length, grpB.length),
          aSamples: grpA.length, bSamples: grpB.length,
        };
      }

      const vA = this._vals(grpA, tell.metric);
      const vB = this._vals(grpB, tell.metric);
      const d  = this._cohensD(vA, vB);
      const absD = Math.abs(d);
      const strength = absD > 0.8 ? 'strong' : absD > 0.4 ? 'moderate' : absD > 0.18 ? 'weak' : 'none';

      return {
        ...tell, hasData: true, d, strength,
        description: d > 0.18 ? tell.descHigh : d < -0.18 ? tell.descLow : 'No significant pattern yet.',
        aSamples: grpA.length, bSamples: grpB.length,
      };
    });

    // Sort: strong tells first, then moderate, then weak, then learning (no data)
    const order = { strong: 0, moderate: 1, weak: 2, none: 3 };
    const sorted = tells
      .filter(t => !t.hasData || t.strength !== 'none')
      .sort((a, b) => {
        if (!a.hasData && !b.hasData) return 0;
        if (!a.hasData) return 1;
        if (!b.hasData) return -1;
        return (order[a.strength] ?? 3) - (order[b.strength] ?? 3) || Math.abs(b.d) - Math.abs(a.d);
      });

    // Group by category
    const cats = {};
    sorted.forEach(t => {
      const c = t.cat || 'Other';
      if (!cats[c]) cats[c] = [];
      cats[c].push(t);
    });

    return {
      totalSamples:   allResolved.length,
      bettingSamples: agg.length,
      passiveSamples: pass.length,
      foldSamples:    folds.length,
      // Outcome-based (only reliable after enough resolved hands)
      valueSamples:   valueBets.length,
      lostBetSamples: lostBets.length,
      // Sizing-based stats
      avgBetRatio,
      overbetCount,
      smallBetCount,
      totalBets:      agg.filter(e => e.betRatio >= 0).length,
      tells:          sorted,
      byCategory:     cats,
    };
  }

  // ── Live metrics for camera overlay ───────────────────────────────────────
  getCurrent() {
    const recent = this.frames.slice(-8);
    if (!recent.length) return null;
    const avg = k => recent.reduce((s, f) => s + (f[k] || 0), 0) / recent.length;
    return {
      blink:      avg('eyeBlink'),
      browRaise:  avg('browRaise'),
      smile:      avg('smile'),
      lipPress:   avg('lipPress'),
      eyeWide:    avg('eyeWide'),
      noseSneer:  avg('noseSneer'),
    };
  }
}

export const tellDetector = new TellDetector();
