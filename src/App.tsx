import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import "./App.css";

type Outcome = "HIGH" | "LOW";

type ChoiceInternal = {
  outcome: Outcome;
  delta: number;
  text: string;
};

type StagePhase = "intro" | "questions" | "ending";

type AnswerRecord = {
  turnId: number;
  chosenOptionNumber: number;
  questionText: string;
  chosenAnswerText: string;
  outcome: Outcome;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
};

type ShipHumNodes = {
  masterGain: GainNode;
  oscillators: OscillatorNode[];
};

type SpeechVariant = {
  rate: number;
  pitch: number;
  volumeScale: number;
  openAiVoice?: string;
  openAiStyle?: string;
};

type QuestionSpeechProfile = {
  variants: SpeechVariant[];
  openAiOnly: boolean;
  overlayAlienOnOpenAi: boolean;
  effectPreset: "none" | "whisper" | "layered" | "echo";
};

type QuestionSpeechSegment = {
  text: string;
  profile: QuestionSpeechProfile;
};

type PreparedSpeechLayer = {
  url: string;
  volumeScale: number;
};

type PreparedSpeechCacheEntry = {
  layers: PreparedSpeechLayer[];
};

type ActiveSpeechLayer = {
  audio: HTMLAudioElement;
  volumeScale: number;
};

type FloatingWallSymbol = {
  sprite: THREE.Sprite;
  baseY: number;
  angle: number;
  radial: number;
  radialDriftAmplitude: number;
  driftSpeed: number;
  phase: number;
  twinkleSpeed: number;
};

type EndingCinematicStage =
  | "inactive"
  | "room-shake-flash"
  | "fade-room-black"
  | "show-saved"
  | "show-destroyed-earth"
  | "show-destroyed-engulf"
  | "destroyed-fade-black"
  | "complete";

type EndingCinematicState = {
  stage: EndingCinematicStage;
  stageStartedAt: number;
  blastStartedAt: number;
  lastRumbleAt: number;
};

const SCORE_MIN = -10;
const SCORE_MAX = 10;
const TOTAL_TURNS = 10;
const EARTH_SAVED_THRESHOLD = 2;
const DARK_HORROR_AMBIENT_VOLUME_SCALE = 0.06;
const OCEAN_AMBIENCE_VOLUME_SCALE = 1.0;
const DISTANT_EXPLOSION_VOLUME_SCALE = 0.56;
const ENDMUSIC_VOLUME_SCALE = 0.03;
const BUILDUP_VOLUME_SCALE = 0.4;
const BUILDUP_TRIM_OFFSET_SECONDS = 6;
const SHAKING_SHIP_VOLUME_SCALE = 0.32;
const FALLING_SHIP_VOLUME_SCALE = 0.42;
const HEAD_SHAKE_NO_VOLUME_SCALE = 0.22;
const HEAD_SHAKE_YES_VOLUME_SCALE = 0.2;
const HEAD_SHAKE_NO_TRIM_SECONDS = 0.08;
const FLICKER_ZAP_VOLUME_SCALE = 0.45;
const FLICKER_ZAP_SLICE_SECONDS = 0.16;

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function collapseWhitespace(text: string) {
  return text.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function normalizeAnswerText(text: string) {
  return text.replace(/[“”"]/g, "").replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngleRadians(angle: number) {
  const twoPi = Math.PI * 2;
  return ((((angle + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

function shortestAngleDelta(from: number, to: number) {
  return normalizeAngleRadians(to - from);
}

function getQuestionSpeechProfile(contextText: string): QuestionSpeechProfile {
  const normalized = contextText.toLowerCase();
  const hasWhisperCue = /whisper|hushed|murmur|quiet/i.test(normalized);
  const hasLayeredCue = /many voices|multiple voices|layer|overlap|chorus/i.test(normalized);
  const hasEchoBackCue = /duplicate|echo(es|ing)? back|read back/i.test(normalized);

  const profile: QuestionSpeechProfile = {
    variants: [{ rate: 0.78, pitch: 0.45, volumeScale: 0.88 }],
    openAiOnly: false,
    overlayAlienOnOpenAi: false,
    effectPreset: "none",
  };

  if (hasWhisperCue && hasLayeredCue) {
    profile.effectPreset = "layered";
    profile.overlayAlienOnOpenAi = true;
    profile.variants = [
      {
        rate: 0.58,
        pitch: 0.16,
        volumeScale: 0.46,
        openAiVoice: "onyx",
        openAiStyle: "Speak as a dark whispered alien voice. Keep it slow, breathy, and unsettling.",
      },
      {
        rate: 0.94,
        pitch: 0.9,
        volumeScale: 0.24,
        openAiVoice: "fable",
        openAiStyle: "Speak softly as an eerie upper harmonic layer, like a ghostly overlapping voice.",
      },
      {
        rate: 0.74,
        pitch: 0.3,
        volumeScale: 0.29,
        openAiVoice: "echo",
        openAiStyle: "Speak as a hollow ambient undertone. Quiet, distant, and ominous.",
      },
    ];
    return profile;
  }

  if (hasLayeredCue) {
    profile.effectPreset = "layered";
    profile.overlayAlienOnOpenAi = true;
    profile.variants = [
      {
        rate: 0.63,
        pitch: 0.2,
        volumeScale: 0.48,
        openAiVoice: "onyx",
        openAiStyle: "Speak with a cold, ominous robotic tone. Keep it steady and eerie.",
      },
      {
        rate: 0.9,
        pitch: 0.86,
        volumeScale: 0.24,
        openAiVoice: "fable",
        openAiStyle: "Speak as a thin spectral overlay voice, synchronized with the primary line.",
      },
    ];
    return profile;
  }

  if (hasWhisperCue) {
    profile.effectPreset = "whisper";
    profile.overlayAlienOnOpenAi = true;
    profile.variants = [
      {
        rate: 0.61,
        pitch: 0.14,
        volumeScale: 0.45,
        openAiVoice: "onyx",
        openAiStyle: "Whisper this as a dark, close-mic alien murmur. Breath-heavy, unnerving, and low.",
      },
    ];
    return profile;
  }

  if (hasEchoBackCue) {
    profile.openAiOnly = true;
    profile.effectPreset = "echo";
    profile.variants = [
      {
        rate: 0.76,
        pitch: 0.48,
        volumeScale: 0.24,
        openAiVoice: "echo",
        openAiStyle: "Speak in a quiet synthetic tone, as if the listener's voice is being played back in a large metallic chamber.",
      },
    ];
    return profile;
  }

  return profile;
}

function supportsOpenAiGeneration(segment: QuestionSpeechSegment) {
  return segment.profile.variants.some((variant) => Boolean(variant.openAiVoice));
}

function getSpeechSegmentCacheKey(turnId: number, segmentIndex: number, segment: QuestionSpeechSegment) {
  const variantKey = segment.profile.variants
    .map((variant) => `${variant.openAiVoice ?? "none"}:${variant.openAiStyle ?? "none"}:${variant.volumeScale}`)
    .join("|");
  return `${turnId}-${segmentIndex}-${segment.text}-${variantKey}`;
}

function extractQuestionSpeechSegments(text: string): QuestionSpeechSegment[] {
  const normalized = collapseWhitespace(text.replace(/^Alien Vessel:\s*/i, ""));
  const quotesRegex = /["“]([^"”]+)["”]/g;

  const segments: QuestionSpeechSegment[] = [];
  let lastIndex = 0;

  for (const match of normalized.matchAll(quotesRegex)) {
    const quoteText = (match[1] ?? "").trim();
    if (!quoteText) continue;

    const quoteStart = match.index ?? 0;
    const leadingContext = normalized.slice(lastIndex, quoteStart);
    const baseProfile = getQuestionSpeechProfile(leadingContext);

    const isFinalWhyPersist = /why\s+persist\??$/i.test(quoteText) && /repeatedly attempts communication/i.test(normalized);
    const profile = isFinalWhyPersist
      ? {
          variants: [
            {
              rate: 0.5,
              pitch: 0,
              volumeScale: 0.74,
              openAiVoice: "onyx",
              openAiStyle: "Speak in an extremely deep, menacing, inhuman alien tone. Slow, ominous, and threatening.",
            },
            {
              rate: 0.64,
              pitch: 0.22,
              volumeScale: 0.32,
              openAiVoice: "echo",
              openAiStyle: "Add a distant sinister undertone, like a shadow voice under the main line.",
            },
          ],
          openAiOnly: false,
          overlayAlienOnOpenAi: true,
          effectPreset: "layered" as const,
        }
      : baseProfile;

    segments.push({
      text: quoteText,
      profile,
    });

    lastIndex = quoteStart + match[0].length;
  }

  return segments;
}

function pickCreepyVoice(voices: SpeechSynthesisVoice[]) {
  if (voices.length === 0) return null;

  const navWithUAData =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { userAgentData?: { platform?: string } })
      : null;
  const platform = (navWithUAData?.userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();

  const findPreferredVoice = (namePattern: RegExp) =>
    voices.find((voice) => namePattern.test(voice.name) && /^en/i.test(voice.lang));

  const findWithPriorityPatterns = (candidateVoices: SpeechSynthesisVoice[], isMacPlatform: boolean) => {
    const voicePriority = [
      /zira|hazel|hedda|susan|sara|mark|david|zira/i,
      /microsoft|google|samantha|alex|victoria/i,
      /en[-_](us|gb|ca|au)/i,
      /en/i,
    ];

    const filteredCandidates = isMacPlatform
      ? candidateVoices.filter((voice) => !/\balex\b/i.test(voice.name))
      : candidateVoices;

    for (const pattern of voicePriority) {
      const matched = filteredCandidates.find((voice) => pattern.test(`${voice.name} ${voice.lang}`));
      if (matched) return matched;
    }

    return null;
  };

  const isMacPlatform = platform.includes("mac");

  if (isMacPlatform) {
    const macPreferred =
      findPreferredVoice(/^aaron$/i) ??
      findPreferredVoice(/\baaron\b/i) ??
      findPreferredVoice(/^samantha$/i) ??
      findPreferredVoice(/\bsamantha\b/i);
    if (macPreferred) return macPreferred;
  }

  if (platform.includes("win")) {
    const windowsPreferred =
      findPreferredVoice(/^microsoft david\b/i) ?? findPreferredVoice(/microsoft david/i);
    if (windowsPreferred) return windowsPreferred;
  }

  const englishVoices = voices.filter((voice) => /^en/i.test(voice.lang));
  const englishMatch = findWithPriorityPatterns(englishVoices, isMacPlatform);
  if (englishMatch) return englishMatch;

  const anyLanguageMatch = findWithPriorityPatterns(voices, isMacPlatform);
  if (anyLanguageMatch) return anyLanguageMatch;

  return voices[0] ?? null;
}

function hasStructuredExplanationFormat(text: string) {
  const normalized = text.trim();
  const hasAllQuestions = Array.from({ length: TOTAL_TURNS }, (_, index) =>
    new RegExp(`(^|\\n)Q${index + 1}:`, "i").test(normalized),
  ).every(Boolean);
  const hasOverall = /(^|\n)Overall:/i.test(normalized);
  return hasAllQuestions && hasOverall;
}

function fallbackOutcomeExplanation(saved: boolean, score: number, history: AnswerRecord[]) {
  const highCount = history.filter((h) => h.outcome === "HIGH").length;
  const lowCount = history.length - highCount;

  const perQuestion = Array.from({ length: TOTAL_TURNS }, (_, index) => {
    const questionNumber = index + 1;
    const picked = history.find((h) => h.turnId === questionNumber);

    if (!picked) {
      return `Q${questionNumber}: No recorded answer for this question, so no protocol impact was applied.`;
    }

    const choiceText = normalizeAnswerText(picked.chosenAnswerText);

    if (picked.delta > 0) {
      return `Q${questionNumber}: You chose "${choiceText}". This increased your score (+1) because it showed openness, adaptation, and willingness to interpret intelligence beyond human-centered assumptions.`;
    }

    return `Q${questionNumber}: You chose "${choiceText}". This reduced your score (-1) because it reflected a more human-centered framing and weaker cross-species perspective-taking.`;
  }).join("\n\n");

  const overall = saved
    ? `Overall: Earth was spared because your final pattern included enough perspective-taking choices to reach ${score}, which is at or above the required threshold of ${EARTH_SAVED_THRESHOLD}. You selected ${highCount} favorable responses versus ${lowCount} unfavorable responses.`
    : `Overall: Earth was destroyed because your final pattern stayed below the required threshold. You finished at ${score} (needs ${EARTH_SAVED_THRESHOLD} or higher), with ${highCount} favorable responses and ${lowCount} unfavorable responses.`;

  return `${perQuestion}\n\n${overall}`;
}

async function generateOutcomeExplanation(saved: boolean, score: number, history: AnswerRecord[]) {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  const model = (import.meta.env.VITE_OPENAI_MODEL as string | undefined) ?? "gpt-4o-mini";

  if (!apiKey) {
    return fallbackOutcomeExplanation(saved, score, history);
  }

  const detailedQuestions = QUESTION_CONTENT.map((question, index) => {
    const questionNumber = index + 1;
    const picked = history.find((h) => h.turnId === questionNumber);

    const options = question.choices
      .map((choice, choiceIndex) => {
        const optionLabel = String.fromCharCode(65 + choiceIndex);
        const isPicked = picked && normalizeAnswerText(choice.text) === normalizeAnswerText(picked.chosenAnswerText);

        return `  ${optionLabel}. ${normalizeAnswerText(choice.text)} | weight: ${choice.delta > 0 ? "+1" : "-1"}${isPicked ? " | PICKED" : ""}`;
      })
      .join("\n");

    const pickedLine = picked
      ? `Picked option summary: ${normalizeAnswerText(picked.chosenAnswerText)} | picked weight: ${picked.delta > 0 ? "+1" : "-1"}`
      : "Picked option summary: (none recorded)";

    return `Q${questionNumber}: ${collapseWhitespace(question.alienLine)}\n${options}\n${pickedLine}`;
  }).join("\n\n");

  const rubric = `Interpretation rules for this game:
- +1 means the answer reduces human-centric bias, shows perspective-taking across species, and treats intelligence/communication as potentially non-human.
- -1 means the answer imposes human bias or dominance assumptions on other species, reducing adaptive understanding.
- Earth is spared when the overall pattern trends toward +1 logic strongly enough.
- Earth explodes when the pattern trends toward -1 logic strongly enough.`;

  const prompt = `You are writing the ending analysis for a story game in 6-9 concise sentences.
Outcome: ${saved ? "Earth was spared" : "Earth exploded"}
Final score: ${score}

${rubric}

Full question, option, and picked-answer data:
${detailedQuestions}

Task:
1) Explain why this specific outcome happened using the full set of player choices.
2) Explicitly connect chosen -1 answers to human bias/anthropocentric framing when relevant.
3) Explicitly connect chosen +1 answers to perspective-taking and cross-species thinking when relevant.
4) Keep it natural and readable for players.

Output format rules (mandatory):
- Return exactly 11 labeled sections in this order: Q1 through Q10, then Overall.
- Use this label syntax exactly: "Q1:", "Q2:", ... "Q10:", and "Overall:".
- Each Q section must be 1-2 sentences focused on that question's selected answer.
- Overall must be 2-4 sentences summarizing why Earth was spared or destroyed.`;

  async function requestCompletion(requestPrompt: string, temperature: number) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [{ role: "user", content: requestPrompt }],
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) return null;
    return content.trim();
  }

  try {
    const firstPass = await requestCompletion(prompt, 0.4);
    if (firstPass && hasStructuredExplanationFormat(firstPass)) {
      return firstPass;
    }

    const repairPrompt = `Rewrite the following analysis to comply with the required output format exactly.

Required labels and order:
Q1:
Q2:
Q3:
Q4:
Q5:
Q6:
Q7:
Q8:
Q9:
Q10:
Overall:

Rules:
- Keep all reasoning grounded in the provided game data.
- Keep each Q section to 1-2 sentences.
- Keep Overall to 2-4 sentences.

Game data:
${detailedQuestions}

Current analysis to rewrite:
${firstPass ?? "(none)"}`;

    const repaired = await requestCompletion(repairPrompt, 0.2);
    if (repaired && hasStructuredExplanationFormat(repaired)) {
      return repaired;
    }

    return fallbackOutcomeExplanation(saved, score, history);
  } catch {
    return fallbackOutcomeExplanation(saved, score, history);
  }
}

const QUESTION_CONTENT: Array<{ alienLine: string; choices: ChoiceInternal[] }> = [
  {
    alienLine:
      'Alien Vessel: "We reviewed recordings of humans speaking to animals. You often repeat phrases… even when no reply arrives." The alien watches you without blinking. "Why continue this behavior?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "Sometimes talking helps humans build emotional connection, even if animals respond differently.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "We’re trying to notice patterns in how animals communicate back, even if it’s unfamiliar.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "It helps humans practice empathy and attentiveness toward other living things.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "We suspect animals might already be communicating — we just don’t fully recognize it yet.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "We intercepted creative work produced alongside your machines." A faint duplicate of your voice echoes back at you. "What are these machines to you?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "Resources that help us execute ideas faster.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Partners that sometimes push our ideas into directions we wouldn’t reach alone.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "Instruments that expand human creativity.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "New participants in creative processes, even if their thinking isn’t human-like.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "We transmitted signals your scientists labeled inconclusive. What does your species usually do when meaning is unclear?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "Translate it into the closest human concept so we can study it.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Observe longer and adjust how we interpret signals.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "Hold onto the information until we find a practical application.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Accept that understanding may require changing our expectations.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "Our thoughts move across many bodies simultaneously. Yours often prioritize independence." Multiple whispers overlap behind its voice. "How do you compare these ways of thinking?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "Independent thinking protects originality and accountability.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Collective thinking can reveal patterns individuals might miss.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Both forms exist because they solve different survival challenges.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "Independent thinking is easier to measure and manage.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "You preserve memories in digital and physical archives... What motivates this preservation?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "It allows humans to build continuity and shared learning.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "It begins to include new perspectives.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "It helps stabilize cultural identity across time.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "It allows knowledge to evolve through contributions from many types of observers.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "We observed humans collecting data from ecosystems." The room briefly fills with ocean sounds. "How do you justify this practice?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "It helps humans predict environmental changes that affect our survival.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "It helps humans understand systems they depend on, which may encourage protection.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "It provides reliable information for technological progress.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "It helps reveal relationships inside ecosystems humans are not regularly in.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "We noticed that you often place yourselves at the center of planetary decisions... What role do humans naturally lean toward?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "Organizers — humans often coordinate complex systems efficiently.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Participants — contributing knowledge without assuming authority.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "Innovators — improving natural systems with engineered ones.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Observers who adapt their behavior based on other species’ signals.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "You describe writing as uniquely human." The alien produces a geometric pulse pattern across the wall. "How do you define writing?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "A system humans developed to store thoughts in permanent form.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "A process that may include signals, behaviors, and patterns across species.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "A method for documenting events as accurately as possible.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "An evolving exchange between different forms of intelligence.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "Some of your technologies now simulate companionship. How does your species respond to this development?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "They offer comfort when human interaction is limited.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "They change how humans understand relationships and communication.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "They provide consistent interaction without emotional unpredictability.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "They introduce new forms of collaboration and expression.",
      },
    ],
  },
  {
    alienLine:
      'Alien Vessel: "Your species repeatedly attempts communication beyond itself." The ship dims. The alien’s voice layers into many voices. "Why persist?"',
    choices: [
      {
        outcome: "LOW",
        delta: -1,
        text: "Because humans naturally seek to interpret the unknown by reference to familiar frameworks.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Because understanding may emerge through shared effort, even without full translation.",
      },
      {
        outcome: "LOW",
        delta: -1,
        text: "Social connectivity is the primary vehicle through which personal influence is projected and magnified.",
      },
      {
        outcome: "HIGH",
        delta: +1,
        text: "Because redefining communication expands how intelligence itself is understood.",
      },
    ],
  },
];

const GEOMETRIC_SYMBOLS_TURN_INDEX = QUESTION_CONTENT.findIndex((question) =>
  /geometric pulse pattern/i.test(question.alienLine),
);
const OCEAN_SOUNDS_TURN_INDEX = QUESTION_CONTENT.findIndex((question) => /ocean sounds/i.test(question.alienLine));

function createSpaceshipInterior(): THREE.Group {
  const ship = new THREE.Group();

  const createMetalPanelTexture = (baseHex: string, lineHex: string) => {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.fillStyle = baseHex;
    context.fillRect(0, 0, size, size);

    context.strokeStyle = lineHex;
    context.lineWidth = 2;

    const step = 64;
    for (let x = 0; x <= size; x += step) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, size);
      context.stroke();
    }

    for (let y = 0; y <= size; y += step) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
    }

    context.fillStyle = "rgba(255,255,255,0.22)";
    for (let y = step; y < size; y += step) {
      for (let x = step; x < size; x += step) {
        context.beginPath();
        context.arc(x - 8, y - 8, 2.2, 0, Math.PI * 2);
        context.fill();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };

  const wallPanelTexture = createMetalPanelTexture("#555b63", "#3d434c");
  const floorPanelTexture = createMetalPanelTexture("#20242a", "#323741");
  const ceilingPanelTexture = createMetalPanelTexture("#5e6672", "#4a5260");
  const roomRadius = 6.4;
  const roomHeight = 4.8;
  const roomCenterY = 1.95;
  const sideWindowRadius = 6.08;
  const sideWindowCenterY = 2.08;
  const sideWindowInnerWidth = 3.737;
  const sideWindowInnerHeight = 1.608;
  const sideWindowBorderThickness = 0.08;
  const sideWindowFrameDepth = 0.04;

  const createRoomWindowMaskTexture = (wallRadiusForUv: number, wallHeightForUv: number, wallCenterYForUv: number) => {
    const width = 2048;
    const height = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    const openWidthUv =
      (sideWindowInnerWidth + sideWindowBorderThickness * 1.6) / (Math.PI * 2 * wallRadiusForUv);
    const openHeightV = (sideWindowInnerHeight + sideWindowBorderThickness * 1.6) / wallHeightForUv;
    const centerV = THREE.MathUtils.clamp((sideWindowCenterY - wallCenterYForUv) / wallHeightForUv + 0.5, 0, 1);
    const uvAngleOffset = 0.25;
    const angleToU = (angle: number) => ((((angle / (Math.PI * 2) + uvAngleOffset) % 1) + 1) % 1);

    const drawHoleAt = (centerU: number) => {
      const leftPx = (centerU - openWidthUv * 0.5) * width;
      const topPx = (1 - (centerV + openHeightV * 0.5)) * height;
      const holeWidthPx = openWidthUv * width;
      const holeHeightPx = openHeightV * height;

      context.fillStyle = "#000000";
      context.fillRect(leftPx, topPx, holeWidthPx, holeHeightPx);

      if (leftPx < 0) {
        context.fillRect(leftPx + width, topPx, holeWidthPx, holeHeightPx);
      }
      if (leftPx + holeWidthPx > width) {
        context.fillRect(leftPx - width, topPx, holeWidthPx, holeHeightPx);
      }
    };

    drawHoleAt(angleToU(0));
    drawHoleAt(angleToU(Math.PI));

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  };

  const roomWindowMaskTexture = createRoomWindowMaskTexture(roomRadius, roomHeight, roomCenterY);
  const outerWindowMaskTexture = createRoomWindowMaskTexture(7.25, 5.2, 2.2);

  if (wallPanelTexture) {
    wallPanelTexture.repeat.set(6.5, 2.2);
  }

  if (floorPanelTexture) {
    floorPanelTexture.repeat.set(8, 8);
  }

  if (ceilingPanelTexture) {
    ceilingPanelTexture.repeat.set(7, 7);
  }

  const outerWall = new THREE.Mesh(
    new THREE.CylinderGeometry(7.25, 7.25, 5.2, 64, 1, true),
    new THREE.MeshStandardMaterial({
      color: "#737a84",
      map: wallPanelTexture ?? undefined,
      alphaMap: outerWindowMaskTexture ?? undefined,
      transparent: true,
      alphaTest: outerWindowMaskTexture ? 0.45 : 0,
      roughness: 0.78,
      metalness: 0.16,
      side: THREE.BackSide,
    }),
  );
  outerWall.position.y = 2.2;
  ship.add(outerWall);

  const outerFloor = new THREE.Mesh(
    new THREE.CircleGeometry(7.25, 64),
    new THREE.MeshStandardMaterial({
      color: "#878c94",
      map: floorPanelTexture ?? undefined,
      roughness: 0.8,
      metalness: 0.14,
    }),
  );
  outerFloor.rotation.x = -Math.PI / 2;
  ship.add(outerFloor);

  const room = new THREE.Mesh(
    new THREE.CylinderGeometry(roomRadius, roomRadius, roomHeight, 56, 1, true),
    new THREE.MeshStandardMaterial({
      color: "#727983",
      map: wallPanelTexture ?? undefined,
      alphaMap: roomWindowMaskTexture ?? undefined,
      transparent: true,
      alphaTest: roomWindowMaskTexture ? 0.45 : 0,
      roughness: 0.8,
      metalness: 0.14,
      side: THREE.BackSide,
    }),
  );
  room.position.y = roomCenterY;
  ship.add(room);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6.4, 56),
    new THREE.MeshStandardMaterial({
      color: "#9398a0",
      map: floorPanelTexture ?? undefined,
      roughness: 0.82,
      metalness: 0.12,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  ship.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(6.4, 56),
    new THREE.MeshStandardMaterial({
      color: "#7e8691",
      map: ceilingPanelTexture ?? undefined,
      roughness: 0.72,
      metalness: 0.18,
    }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 4.35;
  ship.add(ceiling);

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: "#1a2230",
    emissive: "#000000",
    emissiveIntensity: 0,
    roughness: 0.74,
    metalness: 0.36,
  });

  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.15 + i * 0.65, 0.08, 20, 80), ringMaterial);
    ring.position.y = 1.49 + i * 0.92 + (i === 1 ? 0.14 : 0);
    ring.rotation.x = Math.PI / 2;
    ship.add(ring);
  }

  const centerPlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.45, 0.28, 48),
    new THREE.MeshStandardMaterial({ color: "#121928", roughness: 0.88, metalness: 0.25 }),
  );
  centerPlatform.position.y = 0.14;
  ship.add(centerPlatform);

  const wireMaterial = new THREE.MeshStandardMaterial({
    color: "#6a5418",
    emissive: "#7a6121",
    emissiveIntensity: 0.24,
    roughness: 0.32,
    metalness: 0.16,
    transparent: false,
    opacity: 1,
  });

  const wallWireRadius = 6.22;
  const wireWindowGapHalfAngle =
    (sideWindowInnerWidth * 0.5 + sideWindowBorderThickness * 2) / wallWireRadius + 0.1;
  const isInWindowGap = (angle: number) => {
    return (
      Math.abs(shortestAngleDelta(angle, 0)) < wireWindowGapHalfAngle ||
      Math.abs(shortestAngleDelta(angle, Math.PI)) < wireWindowGapHalfAngle
    );
  };

  const wireRingTop = new THREE.Mesh(new THREE.TorusGeometry(wallWireRadius, 0.042, 12, 120), wireMaterial);
  wireRingTop.position.y = 3.88;
  wireRingTop.rotation.x = Math.PI / 2;
  ship.add(wireRingTop);

  const wireRingBottom = new THREE.Mesh(new THREE.TorusGeometry(wallWireRadius, 0.042, 12, 120), wireMaterial);
  wireRingBottom.position.y = 0.52;
  wireRingBottom.rotation.x = Math.PI / 2;
  ship.add(wireRingBottom);

  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2;
    if (isInWindowGap(angle)) {
      continue;
    }
    const radial = wallWireRadius;
    const x = Math.cos(angle) * radial;
    const z = Math.sin(angle) * radial;

    const midX = Math.cos(angle + 0.05) * (radial - 0.06);
    const midZ = Math.sin(angle + 0.05) * (radial - 0.06);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 3.88, z),
      new THREE.Vector3(midX, 2.35, midZ),
      new THREE.Vector3(x, 0.52, z),
    ]);

    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.024, 10, false), wireMaterial);
    ship.add(cable);
  }

  const deepSpaceStarCount = 1550;
  const deepSpaceMinRadius = 78;
  const deepSpaceMaxRadius = 146;
  const deepSpacePositions = new Float32Array(deepSpaceStarCount * 3);
  for (let i = 0; i < deepSpaceStarCount; i++) {
    const i3 = i * 3;
    const direction = new THREE.Vector3(
      Math.random() * 2 - 1,
      (Math.random() * 2 - 1) * 0.72,
      Math.random() * 2 - 1,
    ).normalize();
    const radius = deepSpaceMinRadius + Math.random() * (deepSpaceMaxRadius - deepSpaceMinRadius);
    deepSpacePositions[i3] = direction.x * radius;
    deepSpacePositions[i3 + 1] = direction.y * radius + 1.95;
    deepSpacePositions[i3 + 2] = direction.z * radius;
  }

  const deepSpaceGeometry = new THREE.BufferGeometry();
  deepSpaceGeometry.setAttribute("position", new THREE.BufferAttribute(deepSpacePositions, 3));
  const deepSpaceStars = new THREE.Points(
    deepSpaceGeometry,
    new THREE.PointsMaterial({
      color: "#c9cfdb",
      size: 0.07,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      depthTest: true,
      fog: false,
    }),
  );
  deepSpaceStars.name = "deep-space-stars";
  ship.add(deepSpaceStars);

  const createSideWallWindow = (angle: number, showEarth = false) => {
    const windowGroup = new THREE.Group();
    windowGroup.position.set(
      Math.cos(angle) * sideWindowRadius,
      sideWindowCenterY,
      Math.sin(angle) * sideWindowRadius,
    );
    windowGroup.lookAt(0, sideWindowCenterY, 0);

    const frameOuterMaterial = new THREE.MeshStandardMaterial({
      color: "#3a4452",
      emissive: "#1c2430",
      emissiveIntensity: 0.22,
      roughness: 0.56,
      metalness: 0.38,
    });

    const frameOuterTop = new THREE.Mesh(
      new THREE.BoxGeometry(
        sideWindowInnerWidth + sideWindowBorderThickness * 2,
        sideWindowBorderThickness,
        sideWindowFrameDepth,
      ),
      frameOuterMaterial,
    );
    frameOuterTop.position.set(0, sideWindowInnerHeight * 0.5 + sideWindowBorderThickness * 0.5, -0.02);
    windowGroup.add(frameOuterTop);

    const frameOuterBottom = new THREE.Mesh(
      new THREE.BoxGeometry(
        sideWindowInnerWidth + sideWindowBorderThickness * 2,
        sideWindowBorderThickness,
        sideWindowFrameDepth,
      ),
      frameOuterMaterial,
    );
    frameOuterBottom.position.set(0, -sideWindowInnerHeight * 0.5 - sideWindowBorderThickness * 0.5, -0.02);
    windowGroup.add(frameOuterBottom);

    const frameOuterLeft = new THREE.Mesh(
      new THREE.BoxGeometry(
        sideWindowBorderThickness,
        sideWindowInnerHeight + sideWindowBorderThickness * 2,
        sideWindowFrameDepth,
      ),
      frameOuterMaterial,
    );
    frameOuterLeft.position.set(-sideWindowInnerWidth * 0.5 - sideWindowBorderThickness * 0.5, 0, -0.02);
    windowGroup.add(frameOuterLeft);

    const frameOuterRight = new THREE.Mesh(
      new THREE.BoxGeometry(
        sideWindowBorderThickness,
        sideWindowInnerHeight + sideWindowBorderThickness * 2,
        sideWindowFrameDepth,
      ),
      frameOuterMaterial,
    );
    frameOuterRight.position.set(sideWindowInnerWidth * 0.5 + sideWindowBorderThickness * 0.5, 0, -0.02);
    windowGroup.add(frameOuterRight);

    const windowPaneGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(sideWindowInnerWidth, sideWindowInnerHeight),
      new THREE.MeshBasicMaterial({
        color: "#6f84a0",
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    windowPaneGlow.position.set(0, 0, -0.035);
    windowGroup.add(windowPaneGlow);

    if (showEarth) {
      const windowEarthGroup = new THREE.Group();
      windowEarthGroup.name = "left-window-earth";
      const earthOrbitRadius = 78;
      const earthOrbitStartAngle = Math.PI + 0.55;
      const earthOrbitY = 2.41;
      windowEarthGroup.position.set(
        Math.cos(earthOrbitStartAngle) * earthOrbitRadius,
        earthOrbitY,
        Math.sin(earthOrbitStartAngle) * earthOrbitRadius,
      );
      windowEarthGroup.userData.orbitRadius = earthOrbitRadius;
      windowEarthGroup.userData.orbitStartAngle = earthOrbitStartAngle;
      windowEarthGroup.userData.orbitY = earthOrbitY;
      windowEarthGroup.userData.orbitSpeed = 0.0095;

      const windowEarthFill = new THREE.PointLight("#ffffff", 0.85, 34, 2);
      windowEarthFill.position.set(5.4, 1.6, 1.4);
      windowEarthGroup.add(windowEarthFill);

      ship.add(windowEarthGroup);
    }

    ship.add(windowGroup);
  };

  createSideWallWindow(Math.PI, true);
  createSideWallWindow(0);

  return ship;
}

function createFloatingWallSymbols(): {
  group: THREE.Group;
  symbols: FloatingWallSymbol[];
  textures: THREE.Texture[];
} {
  const group = new THREE.Group();
  const symbols: FloatingWallSymbol[] = [];
  const textures: THREE.Texture[] = [];

  const glyphs = ["✦", "✧", "◌", "⌬", "⟁", "⟡", "⟢", "◇", "⊹", "⋆"];
  const symbolCount = 84;
  const wallSymbolRadiusMin = 6.18;
  const wallSymbolRadiusMax = 6.31;

  for (let i = 0; i < symbolCount; i++) {
    const glyph = glyphs[i % glyphs.length];
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) continue;

    context.clearRect(0, 0, 128, 128);
    context.fillStyle = "rgba(255,255,255,0.95)";
    context.font = "700 84px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "rgba(255,255,255,0.85)";
    context.shadowBlur = 12;
    context.fillText(glyph, 64, 66);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    textures.push(texture);

    const material = new THREE.SpriteMaterial({
      map: texture,
      color: "#ffffff",
      transparent: true,
      opacity: 0.46 + Math.random() * 0.24,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 8;
    const angle = (i / symbolCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
    const radial = wallSymbolRadiusMin + Math.random() * (wallSymbolRadiusMax - wallSymbolRadiusMin);
    const baseY = 0.62 + Math.random() * 3.48;
    const scale = 0.28 + Math.random() * 0.3;
    const radialDriftAmplitude = 0.01 + Math.random() * 0.035;

    sprite.scale.set(scale, scale, 1);
    sprite.position.set(Math.cos(angle) * radial, baseY, Math.sin(angle) * radial);
    group.add(sprite);

    symbols.push({
      sprite,
      baseY,
      angle,
      radial,
      radialDriftAmplitude,
      driftSpeed: 0.22 + Math.random() * 0.38,
      phase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.65 + Math.random() * 1.25,
    });
  }

  return { group, symbols, textures };
}

function enableProceduralLimbMotion(
  root: THREE.Object3D,
  timeUniforms: Array<{ value: number }>,
  headTrackYawUniforms: Array<{ value: number }>,
  headNoUniforms: Array<{ value: number }>,
  headYesUniforms: Array<{ value: number }>,
  armTalkUniforms: Array<{ value: number }>,
  headTalkUniforms: Array<{ value: number }>,
) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) {
      return;
    }

    mesh.geometry.computeBoundingBox();
    const geometryBounds = mesh.geometry.boundingBox;
    if (!geometryBounds) {
      return;
    }

    const size = new THREE.Vector3();
    geometryBounds.getSize(size);

    const minY = geometryBounds.min.y;
    const height = Math.max(size.y, 0.001);
    const halfWidth = Math.max(size.x * 0.5, 0.001);

    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const animatedMaterials = sourceMaterials.map((material) => {
      const stdMat = material as THREE.MeshStandardMaterial;
      const clonedMaterial = stdMat.clone();
      const uLimbTime = { value: 0 };
      const uHeadTrackYaw = { value: 0 };
      const uHeadNo = { value: 0 };
      const uHeadYes = { value: 0 };
      const uArmTalk = { value: 0 };
      const uHeadTalk = { value: 0 };
      timeUniforms.push(uLimbTime);
      headTrackYawUniforms.push(uHeadTrackYaw);
      headNoUniforms.push(uHeadNo);
      headYesUniforms.push(uHeadYes);
      armTalkUniforms.push(uArmTalk);
      headTalkUniforms.push(uHeadTalk);

      clonedMaterial.onBeforeCompile = (shader) => {
        shader.uniforms.uLimbTime = uLimbTime;
        shader.uniforms.uHeadTrackYaw = uHeadTrackYaw;
        shader.uniforms.uHeadNo = uHeadNo;
        shader.uniforms.uHeadYes = uHeadYes;
        shader.uniforms.uArmTalk = uArmTalk;
        shader.uniforms.uHeadTalk = uHeadTalk;
        shader.uniforms.uMinY = { value: minY };
        shader.uniforms.uHeight = { value: height };
        shader.uniforms.uHalfWidth = { value: halfWidth };

        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            `#include <common>
uniform float uLimbTime;
uniform float uHeadTrackYaw;
uniform float uHeadNo;
uniform float uHeadYes;
uniform float uArmTalk;
uniform float uHeadTalk;
uniform float uMinY;
uniform float uHeight;
uniform float uHalfWidth;`,
          )
          .replace(
            "#include <beginnormal_vertex>",
            `vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif

float nYNorm = clamp((position.y - uMinY) / uHeight, 0.0, 1.0);
float nXNorm = clamp((position.x + uHalfWidth) / (uHalfWidth * 2.0), 0.0, 1.0);

float nTopMask = pow(smoothstep(0.71, 0.82, nYNorm), 3.2);
float nTrackAngle = uHeadTrackYaw;
float nTrackCos = cos(nTrackAngle);
float nTrackSin = sin(nTrackAngle);
vec2 nTopTrackLocal = vec2(objectNormal.x, objectNormal.z);
vec2 nTopTrackRotated = vec2(
  nTopTrackLocal.x * nTrackCos - nTopTrackLocal.y * nTrackSin,
  nTopTrackLocal.x * nTrackSin + nTopTrackLocal.y * nTrackCos
);
objectNormal.x = mix(objectNormal.x, nTopTrackRotated.x, nTopMask);
objectNormal.z = mix(objectNormal.z, nTopTrackRotated.y, nTopMask);

float nNoAngle = uHeadNo;
float nNoCos = cos(nNoAngle);
float nNoSin = sin(nNoAngle);
vec2 nTopNoLocal = vec2(objectNormal.x, objectNormal.z);
vec2 nTopNoRotated = vec2(
  nTopNoLocal.x * nNoCos - nTopNoLocal.y * nNoSin,
  nTopNoLocal.x * nNoSin + nTopNoLocal.y * nNoCos
);
objectNormal.x = mix(objectNormal.x, nTopNoRotated.x, nTopMask);
objectNormal.z = mix(objectNormal.z, nTopNoRotated.y, nTopMask);

float nYesAngle = uHeadYes;
float nYesCos = cos(nYesAngle);
float nYesSin = sin(nYesAngle);
vec2 nTopYesLocal = vec2(objectNormal.y, objectNormal.z);
vec2 nTopYesRotated = vec2(
  nTopYesLocal.x * nYesCos - nTopYesLocal.y * nYesSin,
  nTopYesLocal.x * nYesSin + nTopYesLocal.y * nYesCos
);
objectNormal.y = mix(objectNormal.y, nTopYesRotated.x, nTopMask);
objectNormal.z = mix(objectNormal.z, nTopYesRotated.y, nTopMask);

float nHeadTalkStrengthRaw = clamp(uHeadTalk, 0.0, 1.0);
float nHeadTalkStrength = nHeadTalkStrengthRaw * nHeadTalkStrengthRaw * (3.0 - 2.0 * nHeadTalkStrengthRaw);
float nNodPrimary = sin(uLimbTime * 7.6 + sin(uLimbTime * 1.7) * 0.9);
float nNodSecondary = sin(uLimbTime * 12.9 + 0.8);
float nNodAngle = (nNodPrimary * 0.045 + nNodSecondary * 0.018) * nHeadTalkStrength;
float nNodCos = cos(nNodAngle);
float nNodSin = sin(nNodAngle);
vec2 nTopNodLocal = vec2(objectNormal.y, objectNormal.z);
vec2 nTopNodRotated = vec2(
  nTopNodLocal.x * nNodCos - nTopNodLocal.y * nNodSin,
  nTopNodLocal.x * nNodSin + nTopNodLocal.y * nNodCos
);
objectNormal.y = mix(objectNormal.y, nTopNodRotated.x, nTopMask);
objectNormal.z = mix(objectNormal.z, nTopNodRotated.y, nTopMask);

float nLeftHandMaskX = step(0.00, nXNorm) * (1.0 - step(0.27, nXNorm));
float nLeftHandMaskY = step(0.12, nYNorm) * (1.0 - step(0.56, nYNorm));
float nLeftDebugArmMask = nLeftHandMaskX * nLeftHandMaskY;
float nRightHandMaskX = step(0.728, nXNorm) * (1.0 - step(1.01, nXNorm));
float nRightDebugArmMask = nRightHandMaskX * nLeftHandMaskY;

float nTalkStrengthRaw = clamp(uArmTalk, 0.0, 1.0);
float nTalkStrength = nTalkStrengthRaw * nTalkStrengthRaw * (3.0 - 2.0 * nTalkStrengthRaw);
float nTalkBob = sin(uLimbTime * 2.4) * 0.14;
float nArmForwardAngle = -nTalkStrength * (1.6580628 + nTalkBob);
float nArmCos = cos(nArmForwardAngle);
float nArmSin = sin(nArmForwardAngle);

vec2 nLeftArmYZ = vec2(objectNormal.y, objectNormal.z);
vec2 nLeftArmYZRotated = vec2(
  nLeftArmYZ.x * nArmCos - nLeftArmYZ.y * nArmSin,
  nLeftArmYZ.x * nArmSin + nLeftArmYZ.y * nArmCos
);
objectNormal.y = mix(objectNormal.y, nLeftArmYZRotated.x, nLeftDebugArmMask);
objectNormal.z = mix(objectNormal.z, nLeftArmYZRotated.y, nLeftDebugArmMask);

vec2 nRightArmYZ = vec2(objectNormal.y, objectNormal.z);
vec2 nRightArmYZRotated = vec2(
  nRightArmYZ.x * nArmCos - nRightArmYZ.y * nArmSin,
  nRightArmYZ.x * nArmSin + nRightArmYZ.y * nArmCos
);
objectNormal.y = mix(objectNormal.y, nRightArmYZRotated.x, nRightDebugArmMask);
objectNormal.z = mix(objectNormal.z, nRightArmYZRotated.y, nRightDebugArmMask);`,
          )
          .replace(
            "#include <begin_vertex>",
            `vec3 transformed = vec3(position);
float yNorm = clamp((position.y - uMinY) / uHeight, 0.0, 1.0);
float xNorm = clamp((position.x + uHalfWidth) / (uHalfWidth * 2.0), 0.0, 1.0);

float bodyMask = smoothstep(0.08, 0.72, yNorm) * (1.0 - smoothstep(0.74, 0.87, yNorm));
float breathingLift = sin(uLimbTime * 1.785 + 0.25);

transformed.y += bodyMask * breathingLift * (uHeight * 0.0075);

float topMask = pow(smoothstep(0.71, 0.82, yNorm), 3.2);
float trackAngle = uHeadTrackYaw;
float trackCos = cos(trackAngle);
float trackSin = sin(trackAngle);
vec2 topTrackLocal = vec2(transformed.x, transformed.z);
vec2 topTrackRotated = vec2(
  topTrackLocal.x * trackCos - topTrackLocal.y * trackSin,
  topTrackLocal.x * trackSin + topTrackLocal.y * trackCos
);

transformed.x = mix(transformed.x, topTrackRotated.x, topMask);
transformed.z = mix(transformed.z, topTrackRotated.y, topMask);

float noAngle = uHeadNo;
float pivotY = uMinY + uHeight * 0.75;

float noCos = cos(noAngle);
float noSin = sin(noAngle);
vec2 topNoLocal = vec2(transformed.x, transformed.z);
vec2 topNoRotated = vec2(
  topNoLocal.x * noCos - topNoLocal.y * noSin,
  topNoLocal.x * noSin + topNoLocal.y * noCos
);

transformed.x = mix(transformed.x, topNoRotated.x, topMask);
transformed.z = mix(transformed.z, topNoRotated.y, topMask);

float yesAngle = uHeadYes;
float yesCos = cos(yesAngle);
float yesSin = sin(yesAngle);
vec2 topYesLocal = vec2(transformed.y - pivotY, transformed.z);
vec2 topYesRotated = vec2(
  topYesLocal.x * yesCos - topYesLocal.y * yesSin,
  topYesLocal.x * yesSin + topYesLocal.y * yesCos
);

transformed.y = mix(transformed.y, topYesRotated.x + pivotY, topMask);
transformed.z = mix(transformed.z, topYesRotated.y, topMask);

float headTalkStrengthRaw = clamp(uHeadTalk, 0.0, 1.0);
float headTalkStrength = headTalkStrengthRaw * headTalkStrengthRaw * (3.0 - 2.0 * headTalkStrengthRaw);
float nodPrimary = sin(uLimbTime * 7.6 + sin(uLimbTime * 1.7) * 0.9);
float nodSecondary = sin(uLimbTime * 12.9 + 0.8);
float nodAngle = (nodPrimary * 0.045 + nodSecondary * 0.018) * headTalkStrength;
float nodCos = cos(nodAngle);
float nodSin = sin(nodAngle);

vec2 topNodLocal = vec2(transformed.y - pivotY, transformed.z);
vec2 topNodRotated = vec2(
  topNodLocal.x * nodCos - topNodLocal.y * nodSin,
  topNodLocal.x * nodSin + topNodLocal.y * nodCos
);

transformed.y = mix(transformed.y, topNodRotated.x + pivotY, topMask);
transformed.z = mix(transformed.z, topNodRotated.y, topMask);`,
          );

        shader.vertexShader = shader.vertexShader.replace(
          "#include <project_vertex>",
          `
float leftHandMaskX = step(0.00, xNorm) * (1.0 - step(0.27, xNorm));
float leftHandMaskY = step(0.12, yNorm) * (1.0 - step(0.56, yNorm));
float leftDebugArmMask = leftHandMaskX * leftHandMaskY;
float rightHandMaskX = step(0.728, xNorm) * (1.0 - step(1.01, xNorm));
float rightHandMaskY = leftHandMaskY;
float rightDebugArmMask = rightHandMaskX * rightHandMaskY;

float talkStrengthRaw = clamp(uArmTalk, 0.0, 1.0);
float talkStrength = talkStrengthRaw * talkStrengthRaw * (3.0 - 2.0 * talkStrengthRaw);
float talkBob = sin(uLimbTime * 2.4) * 0.14;
float armForwardAngle = -talkStrength * (1.6580628 + talkBob);

float armCos = cos(armForwardAngle);
float armSin = sin(armForwardAngle);
float armPivotY = uMinY + uHeight * 0.54;

vec2 leftArmYZ = vec2(transformed.y - armPivotY, transformed.z);
vec2 leftArmYZRotated = vec2(
  leftArmYZ.x * armCos - leftArmYZ.y * armSin,
  leftArmYZ.x * armSin + leftArmYZ.y * armCos
);

transformed.y = mix(transformed.y, leftArmYZRotated.x + armPivotY, leftDebugArmMask);
transformed.z = mix(transformed.z, leftArmYZRotated.y, leftDebugArmMask);

vec2 rightArmYZ = vec2(transformed.y - armPivotY, transformed.z);
vec2 rightArmYZRotated = vec2(
  rightArmYZ.x * armCos - rightArmYZ.y * armSin,
  rightArmYZ.x * armSin + rightArmYZ.y * armCos
);

transformed.y = mix(transformed.y, rightArmYZRotated.x + armPivotY, rightDebugArmMask);
transformed.z = mix(transformed.z, rightArmYZRotated.y, rightDebugArmMask);

#include <project_vertex>
`,
        );
      };

      clonedMaterial.needsUpdate = true;
      return clonedMaterial;
    });

    mesh.material = Array.isArray(mesh.material) ? animatedMaterials : animatedMaterials[0];
  });
}

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<StagePhase>("intro");
  const [turnIndex, setTurnIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [history, setHistory] = useState<AnswerRecord[]>([]);
  const [endingExplanation, setEndingExplanation] = useState("");
  const [revealProgress, setRevealProgress] = useState(0);
  const [isRevealing, setIsRevealing] = useState(false);
  const [typedAlienText, setTypedAlienText] = useState("");
  const [answersVisible, setAnswersVisible] = useState(false);
  const [endingBlackoutOpacity, setEndingBlackoutOpacity] = useState(0);
  const [endingFlashOpacity, setEndingFlashOpacity] = useState(0);
  const [endingPanelVisible, setEndingPanelVisible] = useState(false);
  const [masterVolume, setMasterVolume] = useState(50);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isVolumeOpen, setIsVolumeOpen] = useState(false);
  const isDevBuild = import.meta.env.DEV;
  const voiceEnabled = true;
  const humAudioContextRef = useRef<AudioContext | null>(null);
  const humNodesRef = useRef<ShipHumNodes | null>(null);
  const humOutputGainRef = useRef<GainNode | null>(null);
  const turbulenceTimerRef = useRef<number | null>(null);
  const buttonClickAudioRef = useRef<HTMLAudioElement | null>(null);
  const flickerZapAudioRef = useRef<HTMLAudioElement | null>(null);
  const flickerZapStopTimeoutRef = useRef<number | null>(null);
  const noBeepAudioRef = useRef<HTMLAudioElement | null>(null);
  const yesEchoAudioRef = useRef<HTMLAudioElement | null>(null);
  const revealAudioRef = useRef<HTMLAudioElement | null>(null);
  const revealAudioStartedRef = useRef(false);
  const darkHorrorAmbientAudioRef = useRef<HTMLAudioElement | null>(null);
  const darkHorrorAmbientGainRef = useRef(0);
  const darkHorrorAmbientFadeFrameRef = useRef<number | null>(null);
  const oceanAmbienceAudioRef = useRef<HTMLAudioElement | null>(null);
  const oceanAmbienceGainRef = useRef(0);
  const oceanAmbienceFadeFrameRef = useRef<number | null>(null);
  const oceanAmbiencePauseTimeoutRef = useRef<number | null>(null);
  const distantExplosionAudioRef = useRef<HTMLAudioElement | null>(null);
  const endMusicAudioRef = useRef<HTMLAudioElement | null>(null);
  const endMusicGainRef = useRef(0);
  const endMusicFadeFrameRef = useRef<number | null>(null);
  const endMusicPauseTimeoutRef = useRef<number | null>(null);
  const buildupAudioRef = useRef<HTMLAudioElement | null>(null);
  const buildupGainRef = useRef(0);
  const buildupFadeFrameRef = useRef<number | null>(null);
  const buildupPauseTimeoutRef = useRef<number | null>(null);
  const shakingShipAudioRef = useRef<HTMLAudioElement | null>(null);
  const shakingShipGainRef = useRef(0);
  const shakingShipFadeFrameRef = useRef<number | null>(null);
  const shakingShipStopTimeoutRef = useRef<number | null>(null);
  const fallingShipAudioRef = useRef<HTMLAudioElement | null>(null);
  const fallingShipGainRef = useRef(0);
  const fallingShipFadeFrameRef = useRef<number | null>(null);
  const fallingShipPauseTimeoutRef = useRef<number | null>(null);
  const endingBlackoutOpacityRef = useRef(0);
  const endingFlashOpacityRef = useRef(0);
  const endingPanelVisibleRef = useRef(false);
  const endingSavedOutcomeRef = useRef(false);
  const endingCinematicRef = useRef<EndingCinematicState>({
    stage: "inactive",
    stageStartedAt: 0,
    blastStartedAt: 0,
    lastRumbleAt: 0,
  });
  const masterVolumeRef = useRef(0.5);
  const revealProgressRef = useRef(0);
  const isRevealingRef = useRef(false);
  const phaseRef = useRef<StagePhase>("intro");
  const turnIndexRef = useRef(0);
  const typedQuestionCharsRef = useRef(0);
  const currentQuestionCharsRef = useRef(0);
  const spokenTurnRef = useRef<number | null>(null);
  const speechVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speechDelayTimeoutRef = useRef<number | null>(null);
  const endingEchoTimeoutRef = useRef<number | null>(null);
  const endingEchoPlayedRef = useRef(false);
  const speechGestureUnlockedRef = useRef(false);
  const speechQueueTokenRef = useRef(0);
  const speechAudioLayersRef = useRef<ActiveSpeechLayer[]>([]);
  const speechAbortControllersRef = useRef<AbortController[]>([]);
  const preparedSpeechCacheRef = useRef<Map<string, PreparedSpeechCacheEntry>>(new Map());
  const preparedSpeechPromisesRef = useRef<Map<string, Promise<PreparedSpeechCacheEntry | null>>>(new Map());
  const speechFxContextRef = useRef<AudioContext | null>(null);
  const stunStartedAtRef = useRef(0);
  const stunEndsAtRef = useRef(0);
  const stunIntensityRef = useRef(1);
  const headReactionStartedAtRef = useRef(0);
  const headJoltEndsAtRef = useRef(0);
  const headJoltDirectionRef = useRef(1);
  const headReactionModeRef = useRef<"none" | "no" | "yes">("none");

  const openAiApiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  const openAiTtsModel = (import.meta.env.VITE_OPENAI_TTS_MODEL as string | undefined) ?? "gpt-4o-mini-tts";

  const speechSupported = typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

  const currentTurn = phase === "questions" ? QUESTION_CONTENT[turnIndex] : null;
  const displayChoices = useMemo(() => {
    if (phase !== "questions" || !currentTurn) return [] as ChoiceInternal[];
    return shuffle(currentTurn.choices);
  }, [phase, currentTurn]);

  useEffect(() => {
    if (phase !== "ending") {
      return;
    }

    let isCancelled = false;

    generateOutcomeExplanation(score >= EARTH_SAVED_THRESHOLD, score, history).then((text) => {
      if (isCancelled) return;
      setEndingExplanation(text);
    });

    return () => {
      isCancelled = true;
    };
  }, [phase, score, history]);

  const stopShipHum = useCallback(async () => {
    if (turbulenceTimerRef.current !== null) {
      window.clearTimeout(turbulenceTimerRef.current);
      turbulenceTimerRef.current = null;
    }

    const context = humAudioContextRef.current;
    const nodes = humNodesRef.current;

    if (nodes && context && context.state !== "closed") {
      const now = context.currentTime;
      nodes.masterGain.gain.cancelScheduledValues(now);
      nodes.masterGain.gain.setValueAtTime(Math.max(nodes.masterGain.gain.value, 0.0001), now);
      nodes.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

      for (const osc of nodes.oscillators) {
        osc.stop(now + 0.22);
      }
    }

    humNodesRef.current = null;

    if (context && context.state !== "closed") {
      await context.close();
    }
    humAudioContextRef.current = null;
    humOutputGainRef.current = null;
  }, []);

  const stopQuestionSpeech = useCallback(() => {
    speechQueueTokenRef.current += 1;

    if (speechDelayTimeoutRef.current !== null) {
      window.clearTimeout(speechDelayTimeoutRef.current);
      speechDelayTimeoutRef.current = null;
    }

    for (const controller of speechAbortControllersRef.current) {
      controller.abort();
    }
    speechAbortControllersRef.current = [];

    for (const layer of speechAudioLayersRef.current) {
      layer.audio.pause();
      layer.audio.currentTime = 0;
      layer.audio.src = "";
    }
    speechAudioLayersRef.current = [];

    if (!speechSupported) return;
    window.speechSynthesis.cancel();
  }, [speechSupported]);

  const clearPreparedSpeechCache = useCallback(() => {
    for (const entry of preparedSpeechCacheRef.current.values()) {
      for (const layer of entry.layers) {
        URL.revokeObjectURL(layer.url);
      }
    }

    preparedSpeechCacheRef.current.clear();
    preparedSpeechPromisesRef.current.clear();
  }, []);

  const prepareOpenAiLayeredSpeech = useCallback(
    async (segment: QuestionSpeechSegment, cacheKey: string) => {
      if (!openAiApiKey || !supportsOpenAiGeneration(segment)) {
        return null;
      }

      const cached = preparedSpeechCacheRef.current.get(cacheKey);
      if (cached) {
        return cached;
      }

      const inFlight = preparedSpeechPromisesRef.current.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }

      const promise = (async () => {
        const controller = new AbortController();
        speechAbortControllersRef.current.push(controller);

        try {
          const layeredVariants = segment.profile.variants.filter((variant) => Boolean(variant.openAiVoice));

          const layers = await Promise.all(
            layeredVariants.map(async (variant) => {
              const response = await fetch("https://api.openai.com/v1/audio/speech", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${openAiApiKey}`,
                },
                body: JSON.stringify({
                  model: openAiTtsModel,
                  voice: variant.openAiVoice,
                  input: segment.text,
                  format: "mp3",
                  instructions:
                    variant.openAiStyle ??
                    "Speak in a calm robotic synthetic voice with an ominous tone and minimal emotional variation.",
                }),
                signal: controller.signal,
              });

              if (!response.ok) {
                return null;
              }

              const audioBlob = await response.blob();
              const url = URL.createObjectURL(audioBlob);
              return {
                url,
                volumeScale: variant.volumeScale,
              } satisfies PreparedSpeechLayer;
            }),
          );

          const validLayers = layers.filter((layer): layer is PreparedSpeechLayer => Boolean(layer));
          if (validLayers.length < 1) {
            for (const layer of validLayers) {
              URL.revokeObjectURL(layer.url);
            }
            return null;
          }

          const entry: PreparedSpeechCacheEntry = {
            layers: validLayers,
          };
          preparedSpeechCacheRef.current.set(cacheKey, entry);
          return entry;
        } catch {
          return null;
        } finally {
          speechAbortControllersRef.current = speechAbortControllersRef.current.filter((item) => item !== controller);
          preparedSpeechPromisesRef.current.delete(cacheKey);
        }
      })();

      preparedSpeechPromisesRef.current.set(cacheKey, promise);
      return promise;
    },
    [openAiApiKey, openAiTtsModel],
  );

  const playOpenAiLayeredSpeech = useCallback(
    async (segment: QuestionSpeechSegment, cacheKey: string, normalizedMasterVolume: number, queueToken: number) => {
      if (!openAiApiKey || !supportsOpenAiGeneration(segment)) {
        return false;
      }

      const prepared = await prepareOpenAiLayeredSpeech(segment, cacheKey);
      if (!prepared) {
        return false;
      }

      if (speechQueueTokenRef.current !== queueToken) {
        return false;
      }

      let fxContext = speechFxContextRef.current;
      if (!fxContext || fxContext.state === "closed") {
        fxContext = new AudioContext();
        speechFxContextRef.current = fxContext;
      }

      if (fxContext.state === "suspended") {
        try {
          await fxContext.resume();
        } catch {
          return false;
        }
      }

      const activeLayers = prepared.layers.map((layer) => {
        const audio = new Audio(layer.url);
        audio.preload = "auto";
        audio.muted = masterVolumeRef.current <= 0.0001;
        audio.volume = clamp(normalizedMasterVolume * layer.volumeScale, 0, 1);

        if (segment.profile.effectPreset !== "none" && fxContext) {
          try {
            const source = fxContext.createMediaElementSource(audio);
            const lowpass = fxContext.createBiquadFilter();
            lowpass.type = "lowpass";
            lowpass.frequency.value =
              segment.profile.effectPreset === "whisper" ? 880 : segment.profile.effectPreset === "echo" ? 2200 : 1200;

            const highpass = fxContext.createBiquadFilter();
            highpass.type = "highpass";
            highpass.frequency.value =
              segment.profile.effectPreset === "whisper" ? 85 : segment.profile.effectPreset === "echo" ? 120 : 70;

            const dryGain = fxContext.createGain();
            dryGain.gain.value = 0.9;

            const delay = fxContext.createDelay(0.6);
            delay.delayTime.value =
              segment.profile.effectPreset === "whisper" ? 0.18 : segment.profile.effectPreset === "echo" ? 0.29 : 0.24;

            const feedback = fxContext.createGain();
            feedback.gain.value =
              segment.profile.effectPreset === "whisper" ? 0.2 : segment.profile.effectPreset === "echo" ? 0.36 : 0.28;

            const wetGain = fxContext.createGain();
            wetGain.gain.value =
              segment.profile.effectPreset === "whisper" ? 0.22 : segment.profile.effectPreset === "echo" ? 0.42 : 0.3;

            source.connect(highpass);
            highpass.connect(lowpass);
            lowpass.connect(dryGain);
            dryGain.connect(fxContext.destination);

            lowpass.connect(delay);
            delay.connect(wetGain);
            wetGain.connect(fxContext.destination);
            delay.connect(feedback);
            feedback.connect(delay);

            audio.volume = clamp(normalizedMasterVolume * layer.volumeScale * 0.92, 0, 1);
            audio.playbackRate =
              segment.profile.effectPreset === "whisper"
                ? 0.82
                : segment.profile.effectPreset === "echo"
                  ? 0.9
                  : 0.88;
          } catch {
            audio.playbackRate =
              segment.profile.effectPreset === "whisper"
                ? 0.88
                : segment.profile.effectPreset === "echo"
                  ? 0.93
                  : 0.92;
          }
        }

        speechAudioLayersRef.current.push({
          audio,
          volumeScale: layer.volumeScale,
        });
        return audio;
      });

      const playResults = await Promise.all(
        activeLayers.map(async (audio) => {
          try {
            await audio.play();
            return true;
          } catch {
            return false;
          }
        }),
      );

      const startedLayers = activeLayers.filter((_, index) => playResults[index]);
      if (startedLayers.length < 1) {
        return false;
      }

      if (speechQueueTokenRef.current !== queueToken) {
        for (const audio of startedLayers) {
          audio.pause();
          audio.currentTime = 0;
        }
        return false;
      }

      await Promise.all(
        startedLayers.map(
          (audio) =>
            new Promise<void>((resolve) => {
              const finish = () => {
                audio.removeEventListener("ended", finish);
                audio.removeEventListener("error", finish);
                resolve();
              };

              audio.addEventListener("ended", finish);
              audio.addEventListener("error", finish);
            }),
        ),
      );

      return true;
    },
    [openAiApiKey, prepareOpenAiLayeredSpeech],
  );

  const playTurbulenceOneShot = useCallback(() => {
    const context = humAudioContextRef.current;
    const outputGain = humOutputGainRef.current;

    if (!context || !outputGain || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    const baseFrequency = 170 + Math.random() * 120;

    const bodyOsc = context.createOscillator();
    bodyOsc.type = "triangle";
    bodyOsc.frequency.setValueAtTime(baseFrequency, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(baseFrequency * 0.72, now + 0.16);

    const bodyFilter = context.createBiquadFilter();
    bodyFilter.type = "bandpass";
    bodyFilter.frequency.value = 260 + Math.random() * 180;
    bodyFilter.Q.value = 0.85;

    const bodyGain = context.createGain();
    const intensity = 0.024 + Math.random() * 0.025;
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(intensity, now + 0.018);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    bodyOsc.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(outputGain);

    bodyOsc.start(now);
    bodyOsc.stop(now + 0.22);

    const rattleOsc = context.createOscillator();
    rattleOsc.type = "sine";
    rattleOsc.frequency.setValueAtTime(560 + Math.random() * 220, now);

    const rattleGain = context.createGain();
    rattleGain.gain.setValueAtTime(0.0001, now);
    rattleGain.gain.exponentialRampToValueAtTime(intensity * 0.35, now + 0.008);
    rattleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);

    rattleOsc.connect(rattleGain);
    rattleGain.connect(outputGain);

    rattleOsc.start(now);
    rattleOsc.stop(now + 0.09);
  }, []);

  const playFootstepOneShot = useCallback(() => {
    const context = humAudioContextRef.current;
    const outputGain = humOutputGainRef.current;

    if (!context || !outputGain || context.state !== "running") {
      return;
    }

    const now = context.currentTime;
    const stepGainAmount = 0.14 + Math.random() * 0.04;

    const thumpOsc = context.createOscillator();
    thumpOsc.type = "triangle";
    thumpOsc.frequency.setValueAtTime(84 + Math.random() * 22, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(52 + Math.random() * 12, now + 0.08);

    const thumpGain = context.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime(stepGainAmount, now + 0.008);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    const thumpFilter = context.createBiquadFilter();
    thumpFilter.type = "lowpass";
    thumpFilter.frequency.setValueAtTime(230, now);

    thumpOsc.connect(thumpFilter);
    thumpFilter.connect(thumpGain);
    thumpGain.connect(outputGain);

    thumpOsc.start(now);
    thumpOsc.stop(now + 0.11);

    const hissSource = context.createBufferSource();
    const hissBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.05), context.sampleRate);
    const hissData = hissBuffer.getChannelData(0);
    for (let i = 0; i < hissData.length; i++) {
      hissData[i] = (Math.random() * 2 - 1) * 0.42;
    }
    hissSource.buffer = hissBuffer;

    const hissFilter = context.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.setValueAtTime(820 + Math.random() * 260, now);
    hissFilter.Q.value = 0.7;

    const hissGain = context.createGain();
    hissGain.gain.setValueAtTime(0.0001, now);
    hissGain.gain.exponentialRampToValueAtTime(stepGainAmount * 0.62, now + 0.004);
    hissGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    hissSource.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(outputGain);

    hissSource.start(now);
    hissSource.stop(now + 0.055);
  }, []);

  const playFlickerZapOneShot = useCallback(() => {
    const flickerZap = flickerZapAudioRef.current;
    if (!flickerZap) {
      return;
    }

    if (flickerZapStopTimeoutRef.current !== null) {
      window.clearTimeout(flickerZapStopTimeoutRef.current);
      flickerZapStopTimeoutRef.current = null;
    }

    const clipDuration = FLICKER_ZAP_SLICE_SECONDS;
    const hasDuration = Number.isFinite(flickerZap.duration) && flickerZap.duration > clipDuration;
    const clipStart = hasDuration ? Math.max(0, flickerZap.duration * 0.5 - clipDuration * 0.5) : 0.35;

    try {
      flickerZap.pause();
      flickerZap.currentTime = clipStart;
      flickerZap.volume = clamp(masterVolumeRef.current * FLICKER_ZAP_VOLUME_SCALE, 0, 1);
      const playAttempt = flickerZap.play();
      if (playAttempt && typeof playAttempt.then === "function") {
        void playAttempt.catch(() => {
          return;
        });
      }

      flickerZapStopTimeoutRef.current = window.setTimeout(() => {
        flickerZap.pause();
        flickerZapStopTimeoutRef.current = null;
      }, clipDuration * 1000);
    } catch {
      return;
    }
  }, []);

  const playAlienAirwaveOneShot = useCallback(() => {
    const context = humAudioContextRef.current;
    const outputGain = humOutputGainRef.current;

    if (!context || !outputGain || context.state !== "running") {
      return;
    }

    const now = context.currentTime;

    const shockOsc = context.createOscillator();
    shockOsc.type = "triangle";
    shockOsc.frequency.setValueAtTime(54, now);
    shockOsc.frequency.exponentialRampToValueAtTime(31, now + 0.46);

    const shockFilter = context.createBiquadFilter();
    shockFilter.type = "lowpass";
    shockFilter.frequency.setValueAtTime(180, now);

    const shockGain = context.createGain();
    shockGain.gain.setValueAtTime(0.0001, now);
    shockGain.gain.exponentialRampToValueAtTime(0.12, now + 0.012);
    shockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

    shockOsc.connect(shockFilter);
    shockFilter.connect(shockGain);
    shockGain.connect(outputGain);

    shockOsc.start(now);
    shockOsc.stop(now + 0.52);

    const waveNoiseSource = context.createBufferSource();
    const waveNoiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.34), context.sampleRate);
    const waveNoiseData = waveNoiseBuffer.getChannelData(0);
    for (let i = 0; i < waveNoiseData.length; i++) {
      waveNoiseData[i] = (Math.random() * 2 - 1) * 0.42;
    }
    waveNoiseSource.buffer = waveNoiseBuffer;

    const waveHighpass = context.createBiquadFilter();
    waveHighpass.type = "highpass";
    waveHighpass.frequency.setValueAtTime(430, now);

    const waveBandpass = context.createBiquadFilter();
    waveBandpass.type = "bandpass";
    waveBandpass.frequency.setValueAtTime(980, now);
    waveBandpass.Q.value = 0.72;

    const waveGain = context.createGain();
    waveGain.gain.setValueAtTime(0.0001, now);
    waveGain.gain.exponentialRampToValueAtTime(0.028, now + 0.022);
    waveGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    waveNoiseSource.connect(waveHighpass);
    waveHighpass.connect(waveBandpass);
    waveBandpass.connect(waveGain);
    waveGain.connect(outputGain);

    waveNoiseSource.start(now);
    waveNoiseSource.stop(now + 0.35);
  }, []);

  const playEndingRumbleOneShot = useCallback(() => {
    const context = humAudioContextRef.current;
    const outputGain = humOutputGainRef.current;

    if (!context || !outputGain || context.state !== "running") {
      return;
    }

    const now = context.currentTime;

    const rumbleOsc = context.createOscillator();
    rumbleOsc.type = "triangle";
    rumbleOsc.frequency.setValueAtTime(42 + Math.random() * 8, now);
    rumbleOsc.frequency.exponentialRampToValueAtTime(24 + Math.random() * 4, now + 0.8);

    const rumbleFilter = context.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.setValueAtTime(180, now);

    const rumbleGain = context.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.06, now + 0.08);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.92);

    rumbleOsc.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(outputGain);

    rumbleOsc.start(now);
    rumbleOsc.stop(now + 0.95);
  }, []);

  const triggerAlienAirwaveStun = useCallback((intensity = 1) => {
    const now = performance.now();
    stunStartedAtRef.current = now;
    stunEndsAtRef.current = now + 1700;
    stunIntensityRef.current = clamp(intensity, 0.2, 1);
    playAlienAirwaveOneShot();
  }, [playAlienAirwaveOneShot]);

  const triggerAlienHeadReaction = useCallback((delta: number) => {
    const now = performance.now();
    headReactionStartedAtRef.current = now;

    const playNoShakeSound = () => {
      const noBeep = noBeepAudioRef.current;
      if (!noBeep) return;

      try {
        noBeep.pause();
        noBeep.currentTime = HEAD_SHAKE_NO_TRIM_SECONDS;
        noBeep.volume = clamp(masterVolumeRef.current * HEAD_SHAKE_NO_VOLUME_SCALE, 0, 1);
        const playAttempt = noBeep.play();
        if (playAttempt && typeof playAttempt.then === "function") {
          void playAttempt.catch(() => {
            return;
          });
        }
      } catch {
        return;
      }
    };

    const playYesShakeSound = () => {
      const yesEcho = yesEchoAudioRef.current;
      if (!yesEcho) return;

      try {
        yesEcho.pause();
        yesEcho.currentTime = 0;
        yesEcho.volume = clamp(masterVolumeRef.current * HEAD_SHAKE_YES_VOLUME_SCALE, 0, 1);
        const playAttempt = yesEcho.play();
        if (playAttempt && typeof playAttempt.then === "function") {
          void playAttempt.catch(() => {
            return;
          });
        }
      } catch {
        return;
      }
    };

    if (delta > 0) {
      headReactionModeRef.current = "no";
      headJoltEndsAtRef.current = now + 420;
      headJoltDirectionRef.current = Math.random() < 0.5 ? -1 : 1;
      playNoShakeSound();
      return;
    }

    if (delta < 0) {
      headReactionModeRef.current = "yes";
      headJoltEndsAtRef.current = now + 960;
      headJoltDirectionRef.current = 1;
      playYesShakeSound();
      return;
    }

    headReactionModeRef.current = "none";
    headJoltEndsAtRef.current = now;
  }, []);

  const scheduleTurbulenceSounds = useCallback(() => {
    if (turbulenceTimerRef.current !== null) {
      window.clearTimeout(turbulenceTimerRef.current);
      turbulenceTimerRef.current = null;
    }

    const scheduleNext = () => {
      playTurbulenceOneShot();
      const nextDelay = 2200 + Math.random() * 4800;
      turbulenceTimerRef.current = window.setTimeout(scheduleNext, nextDelay);
    };

    const initialDelay = 1200 + Math.random() * 2600;
    turbulenceTimerRef.current = window.setTimeout(scheduleNext, initialDelay);
  }, [playTurbulenceOneShot]);

  const startShipHum = useCallback(async () => {
    if (humNodesRef.current) {
      return;
    }

    let context = humAudioContextRef.current;
    if (!context || context.state === "closed") {
      context = new AudioContext();
      humAudioContextRef.current = context;
    }

    if (context.state !== "running") {
      try {
        await context.resume();
      } catch {
        return;
      }
    }

    const now = context.currentTime;

    let outputGain = humOutputGainRef.current;
    if (!outputGain) {
      outputGain = context.createGain();
      outputGain.gain.setValueAtTime(Math.max(masterVolumeRef.current, 0.0001), now);
      outputGain.connect(context.destination);
      humOutputGainRef.current = outputGain;
    }

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 42;

    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 880;
    lowpass.Q.value = 0.95;

    const masterGain = context.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.2, now + 0.9);

    highpass.connect(lowpass);
    lowpass.connect(masterGain);
    masterGain.connect(outputGain);

    const osc1 = context.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(84, now);
    const osc1Gain = context.createGain();
    osc1Gain.gain.value = 0.16;
    osc1.connect(osc1Gain);
    osc1Gain.connect(highpass);

    const osc2 = context.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(126, now);
    const osc2Gain = context.createGain();
    osc2Gain.gain.value = 0.082;
    osc2.connect(osc2Gain);
    osc2Gain.connect(highpass);

    const osc3 = context.createOscillator();
    osc3.type = "sine";
    osc3.frequency.setValueAtTime(188, now);
    const osc3Gain = context.createGain();
    osc3Gain.gain.value = 0.044;
    osc3.connect(osc3Gain);
    osc3Gain.connect(highpass);

    const oscillators = [osc1, osc2, osc3];

    for (const osc of oscillators) {
      osc.start(now);
    }

    humNodesRef.current = {
      masterGain,
      oscillators,
    };

    scheduleTurbulenceSounds();
  }, [scheduleTurbulenceSounds]);

  const applyDarkHorrorAmbientVolume = useCallback(() => {
    const ambientAudio = darkHorrorAmbientAudioRef.current;
    if (!ambientAudio) {
      return;
    }

    ambientAudio.volume = clamp(
      masterVolumeRef.current * DARK_HORROR_AMBIENT_VOLUME_SCALE * darkHorrorAmbientGainRef.current,
      0,
      1,
    );
  }, []);

  const fadeDarkHorrorAmbientTo = useCallback(
    (targetGain: number, durationMs: number, onComplete?: () => void) => {
      const target = clamp(targetGain, 0, 1);
      const start = darkHorrorAmbientGainRef.current;

      if (darkHorrorAmbientFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(darkHorrorAmbientFadeFrameRef.current);
        darkHorrorAmbientFadeFrameRef.current = null;
      }

      if (durationMs <= 0 || Math.abs(target - start) < 0.0001) {
        darkHorrorAmbientGainRef.current = target;
        applyDarkHorrorAmbientVolume();
        if (onComplete) onComplete();
        return;
      }

      const startTime = performance.now();
      const animateFade = () => {
        const elapsedMs = performance.now() - startTime;
        const t = clamp(elapsedMs / durationMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        darkHorrorAmbientGainRef.current = THREE.MathUtils.lerp(start, target, eased);
        applyDarkHorrorAmbientVolume();

        if (t < 1) {
          darkHorrorAmbientFadeFrameRef.current = window.requestAnimationFrame(animateFade);
          return;
        }

        darkHorrorAmbientFadeFrameRef.current = null;
        if (onComplete) onComplete();
      };

      darkHorrorAmbientFadeFrameRef.current = window.requestAnimationFrame(animateFade);
    },
    [applyDarkHorrorAmbientVolume],
  );

  const ensureDarkHorrorAmbientPlaying = useCallback(() => {
    const ambientAudio = darkHorrorAmbientAudioRef.current;
    if (!ambientAudio) {
      return;
    }

    const bringToQuietLevel = () => {
      fadeDarkHorrorAmbientTo(1, 2200);
    };

    if (!ambientAudio.paused) {
      bringToQuietLevel();
      return;
    }

    const playAttempt = ambientAudio.play();
    if (playAttempt && typeof playAttempt.then === "function") {
      void playAttempt
        .then(() => {
          bringToQuietLevel();
        })
        .catch(() => {
          return;
        });
      return;
    }

    bringToQuietLevel();
  }, [fadeDarkHorrorAmbientTo]);

  const restartDarkHorrorAmbientWithFade = useCallback(() => {
    const ambientAudio = darkHorrorAmbientAudioRef.current;
    if (!ambientAudio) {
      return;
    }

    fadeDarkHorrorAmbientTo(0, 420, () => {
      ambientAudio.currentTime = 0;
      const playAttempt = ambientAudio.play();
      if (playAttempt && typeof playAttempt.then === "function") {
        void playAttempt
          .then(() => {
            fadeDarkHorrorAmbientTo(1, 1600);
          })
          .catch(() => {
            return;
          });
        return;
      }

      fadeDarkHorrorAmbientTo(1, 1600);
    });
  }, [fadeDarkHorrorAmbientTo]);

  const applyOceanAmbienceVolume = useCallback(() => {
    const oceanAmbience = oceanAmbienceAudioRef.current;
    if (!oceanAmbience) {
      return;
    }

    oceanAmbience.volume = clamp(masterVolumeRef.current * OCEAN_AMBIENCE_VOLUME_SCALE * oceanAmbienceGainRef.current, 0, 1);
  }, []);

  const clearOceanAmbiencePauseTimeout = useCallback(() => {
    if (oceanAmbiencePauseTimeoutRef.current !== null) {
      window.clearTimeout(oceanAmbiencePauseTimeoutRef.current);
      oceanAmbiencePauseTimeoutRef.current = null;
    }
  }, []);

  const clearTrackPauseTimeout = useCallback((timeoutRef: { current: number | null }) => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const fadeOceanAmbienceTo = useCallback(
    (targetGain: number, durationMs: number) => {
      const target = clamp(targetGain, 0, 1);
      const start = oceanAmbienceGainRef.current;

      if (oceanAmbienceFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(oceanAmbienceFadeFrameRef.current);
        oceanAmbienceFadeFrameRef.current = null;
      }

      if (durationMs <= 0 || Math.abs(target - start) < 0.0001) {
        oceanAmbienceGainRef.current = target;
        applyOceanAmbienceVolume();
        return;
      }

      const startTime = performance.now();
      const animateFade = () => {
        const elapsedMs = performance.now() - startTime;
        const t = clamp(elapsedMs / durationMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        oceanAmbienceGainRef.current = THREE.MathUtils.lerp(start, target, eased);
        applyOceanAmbienceVolume();

        if (t < 1) {
          oceanAmbienceFadeFrameRef.current = window.requestAnimationFrame(animateFade);
          return;
        }

        oceanAmbienceFadeFrameRef.current = null;
      };

      oceanAmbienceFadeFrameRef.current = window.requestAnimationFrame(animateFade);
    },
    [applyOceanAmbienceVolume],
  );

  const playDistantExplosionOneShot = useCallback(() => {
    const distantExplosion = distantExplosionAudioRef.current;
    if (!distantExplosion) {
      return;
    }

    try {
      distantExplosion.pause();
      distantExplosion.currentTime = 0;
      distantExplosion.volume = clamp(masterVolumeRef.current * DISTANT_EXPLOSION_VOLUME_SCALE, 0, 1);
      const playAttempt = distantExplosion.play();
      if (playAttempt && typeof playAttempt.then === "function") {
        void playAttempt.catch(() => {
          return;
        });
      }
    } catch {
      return;
    }
  }, []);

  const applyEndMusicVolume = useCallback(() => {
    const endMusic = endMusicAudioRef.current;
    if (!endMusic) {
      return;
    }

    endMusic.volume = clamp(masterVolumeRef.current * ENDMUSIC_VOLUME_SCALE * endMusicGainRef.current, 0, 1);
  }, []);

  const fadeEndMusicTo = useCallback(
    (targetGain: number, durationMs: number) => {
      const target = clamp(targetGain, 0, 1);
      const start = endMusicGainRef.current;

      if (endMusicFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(endMusicFadeFrameRef.current);
        endMusicFadeFrameRef.current = null;
      }

      if (durationMs <= 0 || Math.abs(target - start) < 0.0001) {
        endMusicGainRef.current = target;
        applyEndMusicVolume();
        return;
      }

      const startTime = performance.now();
      const animateFade = () => {
        const elapsedMs = performance.now() - startTime;
        const t = clamp(elapsedMs / durationMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        endMusicGainRef.current = THREE.MathUtils.lerp(start, target, eased);
        applyEndMusicVolume();

        if (t < 1) {
          endMusicFadeFrameRef.current = window.requestAnimationFrame(animateFade);
          return;
        }

        endMusicFadeFrameRef.current = null;
      };

      endMusicFadeFrameRef.current = window.requestAnimationFrame(animateFade);
    },
    [applyEndMusicVolume],
  );

  const applyBuildupVolume = useCallback(() => {
    const buildup = buildupAudioRef.current;
    if (!buildup) {
      return;
    }

    buildup.volume = clamp(masterVolumeRef.current * BUILDUP_VOLUME_SCALE * buildupGainRef.current, 0, 1);
  }, []);

  const fadeBuildupTo = useCallback(
    (targetGain: number, durationMs: number) => {
      const target = clamp(targetGain, 0, 1);
      const start = buildupGainRef.current;

      if (buildupFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(buildupFadeFrameRef.current);
        buildupFadeFrameRef.current = null;
      }

      if (durationMs <= 0 || Math.abs(target - start) < 0.0001) {
        buildupGainRef.current = target;
        applyBuildupVolume();
        return;
      }

      const startTime = performance.now();
      const animateFade = () => {
        const elapsedMs = performance.now() - startTime;
        const t = clamp(elapsedMs / durationMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        buildupGainRef.current = THREE.MathUtils.lerp(start, target, eased);
        applyBuildupVolume();

        if (t < 1) {
          buildupFadeFrameRef.current = window.requestAnimationFrame(animateFade);
          return;
        }

        buildupFadeFrameRef.current = null;
      };

      buildupFadeFrameRef.current = window.requestAnimationFrame(animateFade);
    },
    [applyBuildupVolume],
  );

  const applyShakingShipVolume = useCallback(() => {
    const shakingShip = shakingShipAudioRef.current;
    if (!shakingShip) {
      return;
    }

    shakingShip.volume = clamp(masterVolumeRef.current * SHAKING_SHIP_VOLUME_SCALE * shakingShipGainRef.current, 0, 1);
  }, []);

  const fadeShakingShipTo = useCallback(
    (targetGain: number, durationMs: number, onComplete?: () => void) => {
      const target = clamp(targetGain, 0, 1);
      const start = shakingShipGainRef.current;

      if (shakingShipFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(shakingShipFadeFrameRef.current);
        shakingShipFadeFrameRef.current = null;
      }

      if (durationMs <= 0 || Math.abs(target - start) < 0.0001) {
        shakingShipGainRef.current = target;
        applyShakingShipVolume();
        if (onComplete) onComplete();
        return;
      }

      const startTime = performance.now();
      const animateFade = () => {
        const elapsedMs = performance.now() - startTime;
        const t = clamp(elapsedMs / durationMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        shakingShipGainRef.current = THREE.MathUtils.lerp(start, target, eased);
        applyShakingShipVolume();

        if (t < 1) {
          shakingShipFadeFrameRef.current = window.requestAnimationFrame(animateFade);
          return;
        }

        shakingShipFadeFrameRef.current = null;
        if (onComplete) onComplete();
      };

      shakingShipFadeFrameRef.current = window.requestAnimationFrame(animateFade);
    },
    [applyShakingShipVolume],
  );

  const playShakingShipCue = useCallback(() => {
    const shakingShip = shakingShipAudioRef.current;
    if (!shakingShip) {
      return;
    }

    if (shakingShipStopTimeoutRef.current !== null) {
      window.clearTimeout(shakingShipStopTimeoutRef.current);
      shakingShipStopTimeoutRef.current = null;
    }

    try {
      shakingShip.pause();
      shakingShip.currentTime = 0;
    } catch {
      return;
    }

    shakingShipGainRef.current = 0;
    applyShakingShipVolume();

    const playAttempt = shakingShip.play();
    const startFades = () => {
      fadeShakingShipTo(1, 520);
      shakingShipStopTimeoutRef.current = window.setTimeout(() => {
        fadeShakingShipTo(0, 260, () => {
          shakingShip.pause();
          shakingShip.currentTime = 0;
        });
        shakingShipStopTimeoutRef.current = null;
      }, 1000);
    };

    if (playAttempt && typeof playAttempt.then === "function") {
      void playAttempt
        .then(() => {
          startFades();
        })
        .catch(() => {
          return;
        });
      return;
    }

    startFades();
  }, [applyShakingShipVolume, fadeShakingShipTo]);

  const applyFallingShipVolume = useCallback(() => {
    const fallingShip = fallingShipAudioRef.current;
    if (!fallingShip) {
      return;
    }

    fallingShip.volume = clamp(masterVolumeRef.current * FALLING_SHIP_VOLUME_SCALE * fallingShipGainRef.current, 0, 1);
  }, []);

  const fadeFallingShipTo = useCallback(
    (targetGain: number, durationMs: number) => {
      const target = clamp(targetGain, 0, 1);
      const start = fallingShipGainRef.current;

      if (fallingShipFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(fallingShipFadeFrameRef.current);
        fallingShipFadeFrameRef.current = null;
      }

      if (durationMs <= 0 || Math.abs(target - start) < 0.0001) {
        fallingShipGainRef.current = target;
        applyFallingShipVolume();
        return;
      }

      const startTime = performance.now();
      const animateFade = () => {
        const elapsedMs = performance.now() - startTime;
        const t = clamp(elapsedMs / durationMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        fallingShipGainRef.current = THREE.MathUtils.lerp(start, target, eased);
        applyFallingShipVolume();

        if (t < 1) {
          fallingShipFadeFrameRef.current = window.requestAnimationFrame(animateFade);
          return;
        }

        fallingShipFadeFrameRef.current = null;
      };

      fallingShipFadeFrameRef.current = window.requestAnimationFrame(animateFade);
    },
    [applyFallingShipVolume],
  );

  useEffect(() => {
    const normalized = Math.max(0, Math.min(1, masterVolume / 100));
    const hardMuted = normalized <= 0.0001;
    masterVolumeRef.current = normalized;

    const context = humAudioContextRef.current;
    const outputGain = humOutputGainRef.current;
    if (context && outputGain && context.state !== "closed") {
      const now = context.currentTime;
      outputGain.gain.cancelScheduledValues(now);
      outputGain.gain.setTargetAtTime(normalized, now, 0.03);
    }

    const mediaElements = document.querySelectorAll("audio, video");
    mediaElements.forEach((element) => {
      const media = element as HTMLMediaElement;
      media.volume = normalized;
      media.muted = hardMuted;
    });

    if (buttonClickAudioRef.current) {
      buttonClickAudioRef.current.muted = hardMuted;
      buttonClickAudioRef.current.volume = Math.min(1, normalized * 0.9);
    }

    if (flickerZapAudioRef.current) {
      flickerZapAudioRef.current.muted = hardMuted;
      flickerZapAudioRef.current.volume = clamp(normalized * FLICKER_ZAP_VOLUME_SCALE, 0, 1);
    }

    if (noBeepAudioRef.current) {
      noBeepAudioRef.current.muted = hardMuted;
      noBeepAudioRef.current.volume = clamp(normalized * HEAD_SHAKE_NO_VOLUME_SCALE, 0, 1);
    }

    if (yesEchoAudioRef.current) {
      yesEchoAudioRef.current.muted = hardMuted;
      yesEchoAudioRef.current.volume = clamp(normalized * HEAD_SHAKE_YES_VOLUME_SCALE, 0, 1);
    }

    if (revealAudioRef.current && !isRevealingRef.current) {
      revealAudioRef.current.muted = hardMuted;
      revealAudioRef.current.volume = Math.min(1, normalized * 0.42);
    }

    applyDarkHorrorAmbientVolume();
    applyOceanAmbienceVolume();
    applyEndMusicVolume();
    applyBuildupVolume();
    applyShakingShipVolume();
    applyFallingShipVolume();

    if (distantExplosionAudioRef.current) {
      distantExplosionAudioRef.current.muted = hardMuted;
      distantExplosionAudioRef.current.volume = clamp(normalized * DISTANT_EXPLOSION_VOLUME_SCALE, 0, 1);
    }

    if (speechAudioLayersRef.current.length > 0) {
      for (const layer of speechAudioLayersRef.current) {
        layer.audio.muted = hardMuted;
        layer.audio.volume = clamp(normalized * layer.volumeScale, 0, 1);
      }
    }

    if (hardMuted && speechSupported) {
      window.speechSynthesis.cancel();
    }
  }, [
    applyBuildupVolume,
    applyDarkHorrorAmbientVolume,
    applyEndMusicVolume,
    applyFallingShipVolume,
    applyOceanAmbienceVolume,
    applyShakingShipVolume,
    masterVolume,
    speechSupported,
  ]);

  useEffect(() => {
    const clickAudio = new Audio("/switch_002.ogg");
    clickAudio.preload = "auto";
    clickAudio.volume = Math.min(1, masterVolumeRef.current * 0.9);
    buttonClickAudioRef.current = clickAudio;

    const flickerZap = new Audio("/lightflicker.mp3");
    flickerZap.preload = "auto";
    flickerZap.loop = false;
    flickerZap.volume = clamp(masterVolumeRef.current * FLICKER_ZAP_VOLUME_SCALE, 0, 1);
    flickerZapAudioRef.current = flickerZap;

    const noBeep = new Audio("/nobeep.mp3");
    noBeep.preload = "auto";
    noBeep.loop = false;
    noBeep.volume = clamp(masterVolumeRef.current * HEAD_SHAKE_NO_VOLUME_SCALE, 0, 1);
    noBeepAudioRef.current = noBeep;

    const yesEcho = new Audio("/yesecho.mp3");
    yesEcho.preload = "auto";
    yesEcho.loop = false;
    yesEcho.volume = clamp(masterVolumeRef.current * HEAD_SHAKE_YES_VOLUME_SCALE, 0, 1);
    yesEchoAudioRef.current = yesEcho;

    const revealAudio = new Audio("/horrorLoad.mp3");
    revealAudio.preload = "auto";
    revealAudio.loop = false;
    revealAudio.volume = Math.min(1, masterVolumeRef.current * 0.42);
    revealAudioRef.current = revealAudio;

    const darkHorrorAmbient = new Audio("/universfield-dark-horror-soundscape-345814.mp3");
    darkHorrorAmbient.preload = "auto";
    darkHorrorAmbient.loop = false;
    darkHorrorAmbient.currentTime = 0;
    darkHorrorAmbientGainRef.current = 0;
    darkHorrorAmbientAudioRef.current = darkHorrorAmbient;
    applyDarkHorrorAmbientVolume();

    const handleAmbientRestart = () => {
      restartDarkHorrorAmbientWithFade();
    };

    darkHorrorAmbient.addEventListener("ended", handleAmbientRestart);
    darkHorrorAmbient.addEventListener("error", handleAmbientRestart);
    darkHorrorAmbient.addEventListener("stalled", handleAmbientRestart);

    const oceanAmbience = new Audio("/mixkit-diving-sea-ambience-1205.wav");
    oceanAmbience.preload = "auto";
    oceanAmbience.loop = true;
    oceanAmbience.currentTime = 0;
    oceanAmbienceGainRef.current = 0;
    oceanAmbienceAudioRef.current = oceanAmbience;
    applyOceanAmbienceVolume();

    const distantExplosion = new Audio("/freesound_community-distant-explosion-47562.mp3");
    distantExplosion.preload = "auto";
    distantExplosion.loop = false;
    distantExplosion.volume = clamp(masterVolumeRef.current * DISTANT_EXPLOSION_VOLUME_SCALE, 0, 1);
    distantExplosionAudioRef.current = distantExplosion;

    const endMusic = new Audio("/endmusic.mp3");
    endMusic.preload = "auto";
    endMusic.loop = true;
    endMusic.currentTime = 0;
    endMusicGainRef.current = 0;
    endMusicAudioRef.current = endMusic;
    applyEndMusicVolume();

    const buildup = new Audio("/buildup.mp3");
    buildup.preload = "auto";
    buildup.loop = true;
    buildup.currentTime = 0;
    buildupGainRef.current = 0;
    buildupAudioRef.current = buildup;
    applyBuildupVolume();

    const shakingShip = new Audio("/shakingship.mp3");
    shakingShip.preload = "auto";
    shakingShip.loop = false;
    shakingShip.currentTime = 0;
    shakingShipGainRef.current = 0;
    shakingShipAudioRef.current = shakingShip;
    applyShakingShipVolume();

    const fallingShip = new Audio("/fallingship.mp3");
    fallingShip.preload = "auto";
    fallingShip.loop = true;
    fallingShip.currentTime = 0;
    fallingShipGainRef.current = 0;
    fallingShipAudioRef.current = fallingShip;
    applyFallingShipVolume();

    return () => {
      if (oceanAmbiencePauseTimeoutRef.current !== null) {
        window.clearTimeout(oceanAmbiencePauseTimeoutRef.current);
        oceanAmbiencePauseTimeoutRef.current = null;
      }

      if (endMusicPauseTimeoutRef.current !== null) {
        window.clearTimeout(endMusicPauseTimeoutRef.current);
        endMusicPauseTimeoutRef.current = null;
      }

      if (buildupPauseTimeoutRef.current !== null) {
        window.clearTimeout(buildupPauseTimeoutRef.current);
        buildupPauseTimeoutRef.current = null;
      }

      if (fallingShipPauseTimeoutRef.current !== null) {
        window.clearTimeout(fallingShipPauseTimeoutRef.current);
        fallingShipPauseTimeoutRef.current = null;
      }

      clickAudio.pause();
      buttonClickAudioRef.current = null;

      if (flickerZapStopTimeoutRef.current !== null) {
        window.clearTimeout(flickerZapStopTimeoutRef.current);
        flickerZapStopTimeoutRef.current = null;
      }
      flickerZap.pause();
      flickerZap.currentTime = 0;
      flickerZapAudioRef.current = null;

      noBeep.pause();
      noBeep.currentTime = 0;
      noBeepAudioRef.current = null;

      yesEcho.pause();
      yesEcho.currentTime = 0;
      yesEchoAudioRef.current = null;

      revealAudio.pause();
      revealAudioRef.current = null;

      darkHorrorAmbient.removeEventListener("ended", handleAmbientRestart);
      darkHorrorAmbient.removeEventListener("error", handleAmbientRestart);
      darkHorrorAmbient.removeEventListener("stalled", handleAmbientRestart);
      darkHorrorAmbient.pause();
      darkHorrorAmbient.currentTime = 0;
      darkHorrorAmbientAudioRef.current = null;

      oceanAmbience.pause();
      oceanAmbience.currentTime = 0;
      oceanAmbienceAudioRef.current = null;

      distantExplosion.pause();
      distantExplosion.currentTime = 0;
      distantExplosionAudioRef.current = null;

      endMusic.pause();
      endMusic.currentTime = 0;
      endMusicAudioRef.current = null;

      buildup.pause();
      buildup.currentTime = 0;
      buildupAudioRef.current = null;

      if (shakingShipStopTimeoutRef.current !== null) {
        window.clearTimeout(shakingShipStopTimeoutRef.current);
        shakingShipStopTimeoutRef.current = null;
      }
      shakingShip.pause();
      shakingShip.currentTime = 0;
      shakingShipAudioRef.current = null;

      fallingShip.pause();
      fallingShip.currentTime = 0;
      fallingShipAudioRef.current = null;

      if (darkHorrorAmbientFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(darkHorrorAmbientFadeFrameRef.current);
        darkHorrorAmbientFadeFrameRef.current = null;
      }

      if (oceanAmbienceFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(oceanAmbienceFadeFrameRef.current);
        oceanAmbienceFadeFrameRef.current = null;
      }

      if (endMusicFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(endMusicFadeFrameRef.current);
        endMusicFadeFrameRef.current = null;
      }

      if (buildupFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(buildupFadeFrameRef.current);
        buildupFadeFrameRef.current = null;
      }

      if (shakingShipFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(shakingShipFadeFrameRef.current);
        shakingShipFadeFrameRef.current = null;
      }

      if (fallingShipFadeFrameRef.current !== null) {
        window.cancelAnimationFrame(fallingShipFadeFrameRef.current);
        fallingShipFadeFrameRef.current = null;
      }
    };
  }, [
    applyBuildupVolume,
    applyDarkHorrorAmbientVolume,
    applyEndMusicVolume,
    applyFallingShipVolume,
    applyOceanAmbienceVolume,
    applyShakingShipVolume,
    restartDarkHorrorAmbientWithFade,
  ]);

  useEffect(() => {
    const endMusic = endMusicAudioRef.current;
    if (!endMusic) {
      return;
    }

    if (phase === "ending" && endingPanelVisible) {
      clearTrackPauseTimeout(endMusicPauseTimeoutRef);
      const playAttempt = endMusic.play();
      if (playAttempt && typeof playAttempt.then === "function") {
        void playAttempt
          .then(() => {
            fadeEndMusicTo(1, 1600);
          })
          .catch(() => {
            return;
          });
      } else {
        fadeEndMusicTo(1, 1600);
      }
      return;
    }

    fadeEndMusicTo(0, 700);
    clearTrackPauseTimeout(endMusicPauseTimeoutRef);
    endMusicPauseTimeoutRef.current = window.setTimeout(() => {
      endMusicPauseTimeoutRef.current = null;

      if (phaseRef.current === "ending" && endingPanelVisibleRef.current) {
        return;
      }

      const latestEndMusic = endMusicAudioRef.current;
      if (!latestEndMusic) {
        return;
      }

      latestEndMusic.pause();
      latestEndMusic.currentTime = 0;
    }, 760);
  }, [clearTrackPauseTimeout, endingPanelVisible, fadeEndMusicTo, phase]);

  useEffect(() => {
    if (!speechSupported) {
      speechVoiceRef.current = null;
      return;
    }

    const syncVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      speechVoiceRef.current = pickCreepyVoice(voices);
    };

    syncVoice();
    window.speechSynthesis.addEventListener("voiceschanged", syncVoice);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", syncVoice);
    };
  }, [speechSupported]);

  useEffect(() => {
    const shouldPlayEndingSpeech = speechSupported && masterVolume > 0 && phase === "ending" && endingPanelVisible;
    const isSavedOutcome = endingSavedOutcomeRef.current;

    if (!shouldPlayEndingSpeech) {
      if (endingEchoTimeoutRef.current !== null) {
        window.clearTimeout(endingEchoTimeoutRef.current);
        endingEchoTimeoutRef.current = null;
      }

      if (phase !== "ending") {
        endingEchoPlayedRef.current = false;
      }

      if (speechSupported && masterVolume <= 0) {
        window.speechSynthesis.cancel();
      }
      return;
    }

    if (endingEchoPlayedRef.current) {
      return;
    }

    endingEchoPlayedRef.current = true;
    window.speechSynthesis.cancel();

    const lead = new SpeechSynthesisUtterance(
      isSavedOutcome ? "Earth.. may.. continue" : "Earth.. has failed.. the protocol",
    );
    lead.voice = speechVoiceRef.current;
    lead.lang = speechVoiceRef.current?.lang ?? "en-US";
    lead.rate = isSavedOutcome ? 0.6 : 0.48;
    lead.pitch = isSavedOutcome ? 0.08 : 0.01;
    lead.volume = clamp(masterVolumeRef.current * (isSavedOutcome ? 0.16 : 0.2), 0.02, 0.24);

    lead.onend = () => {
      if (!isSavedOutcome) {
        return;
      }

      if (endingEchoTimeoutRef.current !== null) {
        window.clearTimeout(endingEchoTimeoutRef.current);
      }

      endingEchoTimeoutRef.current = window.setTimeout(() => {
        endingEchoTimeoutRef.current = null;

        if (
          !speechSupported ||
          phaseRef.current !== "ending" ||
          !endingPanelVisibleRef.current ||
          !endingSavedOutcomeRef.current
        ) {
          return;
        }

        const echo = new SpeechSynthesisUtterance("Earth.. may.. continue");
        echo.voice = speechVoiceRef.current;
        echo.lang = speechVoiceRef.current?.lang ?? "en-US";
        echo.rate = 0.56;
        echo.pitch = 0.02;
        echo.volume = clamp(masterVolumeRef.current * 0.07, 0.01, 0.09);
        window.speechSynthesis.speak(echo);
      }, 300);
    };

    lead.onerror = () => {
      return;
    };

    window.speechSynthesis.speak(lead);

    return () => {
      if (endingEchoTimeoutRef.current !== null) {
        window.clearTimeout(endingEchoTimeoutRef.current);
        endingEchoTimeoutRef.current = null;
      }
    };
  }, [speechSupported, masterVolume, phase, endingPanelVisible]);

  const handleGlobalButtonClick = (event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const clickedButton = target.closest("button");
    if (!clickedButton) return;

    const clickAudio = buttonClickAudioRef.current;
    if (!clickAudio) return;

    clickAudio.currentTime = 0;
    void clickAudio.play().catch(() => {
      return;
    });

    if (speechSupported && !speechGestureUnlockedRef.current) {
      try {
        const primer = new SpeechSynthesisUtterance(" ");
        primer.volume = 0;
        window.speechSynthesis.speak(primer);
        window.speechSynthesis.cancel();
      } catch {
        return;
      } finally {
        speechGestureUnlockedRef.current = true;
      }
    }
  };

  useEffect(() => {
    const applyMediaVolume = () => {
      const normalized = masterVolumeRef.current;
      const hardMuted = normalized <= 0.0001;
      const mediaElements = document.querySelectorAll("audio, video");
      mediaElements.forEach((element) => {
        const media = element as HTMLMediaElement;
        media.volume = normalized;
        media.muted = hardMuted;
      });
    };

    applyMediaVolume();
    const observer = new MutationObserver(() => {
      applyMediaVolume();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (phase !== "questions" || !currentTurn) {
      const resetTimeoutId = window.setTimeout(() => {
        setTypedAlienText("");
        setAnswersVisible(false);
      }, 0);

      return () => {
        window.clearTimeout(resetTimeoutId);
      };
    }

    if (isRevealing) {
      const resetTimeoutId = window.setTimeout(() => {
        setTypedAlienText("");
        setAnswersVisible(false);
      }, 0);

      return () => {
        window.clearTimeout(resetTimeoutId);
      };
    }

    const fullText = currentTurn.alienLine.replace("Alien Vessel: ", "");
    let charIndex = 0;
    let timeoutId = 0;

    const typeStep = () => {
      const charsPerTick = fullText.length > 220 ? 2 : 1;
      charIndex = Math.min(fullText.length, charIndex + charsPerTick);
      setTypedAlienText(fullText.slice(0, charIndex));

      if (charIndex < fullText.length) {
        timeoutId = window.setTimeout(typeStep, 26);
      } else {
        setAnswersVisible(true);
      }
    };

    timeoutId = window.setTimeout(() => {
      setTypedAlienText("");
      setAnswersVisible(false);
      typeStep();
    }, 110);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [phase, turnIndex, currentTurn, isRevealing]);

  useEffect(() => {
    const oceanAmbience = oceanAmbienceAudioRef.current;
    if (!oceanAmbience) {
      return;
    }

    const isOceanQuestionActive =
      phase === "questions" && turnIndex === OCEAN_SOUNDS_TURN_INDEX && !isRevealing;

    if (isOceanQuestionActive) {
      clearOceanAmbiencePauseTimeout();
      const playAttempt = oceanAmbience.play();
      if (playAttempt && typeof playAttempt.then === "function") {
        void playAttempt
          .then(() => {
            fadeOceanAmbienceTo(1, 1500);
          })
          .catch(() => {
            return;
          });
      } else {
        fadeOceanAmbienceTo(1, 1500);
      }
      return;
    }

    fadeOceanAmbienceTo(0, 600);

    clearOceanAmbiencePauseTimeout();
    oceanAmbiencePauseTimeoutRef.current = window.setTimeout(() => {
      oceanAmbiencePauseTimeoutRef.current = null;
      if (phaseRef.current === "questions" && turnIndexRef.current === OCEAN_SOUNDS_TURN_INDEX && !isRevealingRef.current) {
        return;
      }

      const latestOcean = oceanAmbienceAudioRef.current;
      if (!latestOcean) {
        return;
      }

      latestOcean.pause();
      latestOcean.currentTime = 0;
    }, 700);
  }, [clearOceanAmbiencePauseTimeout, fadeOceanAmbienceTo, isRevealing, phase, turnIndex]);

  useEffect(() => {
    if (!voiceEnabled || phase !== "questions" || !currentTurn || isRevealing || !openAiApiKey) {
      return;
    }

    const segments = extractQuestionSpeechSegments(currentTurn.alienLine);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex];
      if (!supportsOpenAiGeneration(segment)) {
        continue;
      }

      const cacheKey = getSpeechSegmentCacheKey(turnIndex, segmentIndex, segment);
      void prepareOpenAiLayeredSpeech(segment, cacheKey);
    }
  }, [voiceEnabled, phase, currentTurn, isRevealing, openAiApiKey, turnIndex, prepareOpenAiLayeredSpeech]);

  useEffect(() => {
    if (!speechSupported || !voiceEnabled || phase !== "questions" || !currentTurn || isRevealing || masterVolume <= 0) {
      stopQuestionSpeech();
      if (phase !== "questions") {
        spokenTurnRef.current = null;
      }
      return;
    }

    if (spokenTurnRef.current === turnIndex) {
      return;
    }

    spokenTurnRef.current = turnIndex;
    window.speechSynthesis.cancel();

    const speechSegments = extractQuestionSpeechSegments(currentTurn.alienLine);
    if (speechSegments.length === 0) {
      return;
    }

    const speakDelayMs = 1000;
    const queueToken = speechQueueTokenRef.current;

    speechDelayTimeoutRef.current = window.setTimeout(() => {
      if (speechQueueTokenRef.current !== queueToken) {
        speechDelayTimeoutRef.current = null;
        return;
      }

      const normalizedMasterVolume = masterVolume / 100;

      const speakWithSynth = (segmentText: string, variant: SpeechVariant) =>
        new Promise<void>((resolve) => {
          if (speechQueueTokenRef.current !== queueToken) {
            resolve();
            return;
          }

          let finished = false;
          const finish = () => {
            if (finished) {
              return;
            }
            finished = true;
            window.clearTimeout(fallbackTimeout);
            resolve();
          };

          const utterance = new SpeechSynthesisUtterance(segmentText);
          utterance.voice = speechVoiceRef.current;
          utterance.lang = speechVoiceRef.current?.lang ?? "en-US";
          utterance.rate = clamp(variant.rate, 0.55, 1.08);
          utterance.pitch = clamp(variant.pitch, 0, 1.2);
          utterance.volume = clamp(normalizedMasterVolume * variant.volumeScale, 0, 1);
          utterance.onend = finish;
          utterance.onerror = finish;

          const fallbackTimeout = window.setTimeout(() => {
            finish();
          }, Math.max(2600, segmentText.length * 120));

          try {
            window.speechSynthesis.speak(utterance);
          } catch {
            finish();
          }
        });

      const runSpeechQueue = async () => {
        for (let segmentIndex = 0; segmentIndex < speechSegments.length; segmentIndex++) {
          const segment = speechSegments[segmentIndex];
          if (speechQueueTokenRef.current !== queueToken) {
            break;
          }

          if (/why\s+persist\??$/i.test(segment.text)) {
            triggerAlienAirwaveStun(0.5);
          }

          const cacheKey = getSpeechSegmentCacheKey(turnIndex, segmentIndex, segment);
          if (segment.profile.openAiOnly) {
            const usedOpenAiOnly = await playOpenAiLayeredSpeech(segment, cacheKey, normalizedMasterVolume, queueToken);
            if (usedOpenAiOnly) {
              continue;
            }
          }

          if (segment.profile.overlayAlienOnOpenAi) {
            const isFinalWhyPersist = /why\s+persist\??$/i.test(segment.text);
            const [usedOpenAiPlayback] = await Promise.all([
              playOpenAiLayeredSpeech(segment, cacheKey, normalizedMasterVolume, queueToken),
              speakWithSynth(segment.text, {
                rate: isFinalWhyPersist ? 0.5 : segment.profile.effectPreset === "whisper" ? 0.6 : 0.66,
                pitch: isFinalWhyPersist ? 0 : segment.profile.effectPreset === "whisper" ? 0.08 : 0.16,
                volumeScale: isFinalWhyPersist ? 0.52 : segment.profile.effectPreset === "whisper" ? 0.2 : 0.25,
              }),
            ]);

            if (usedOpenAiPlayback) {
              continue;
            }
          }

          const usedOpenAiPlayback = await playOpenAiLayeredSpeech(segment, cacheKey, normalizedMasterVolume, queueToken);
          if (usedOpenAiPlayback) {
            continue;
          }

          for (const variant of segment.profile.variants) {
            if (speechQueueTokenRef.current !== queueToken) {
              break;
            }
            await speakWithSynth(segment.text, variant);
          }
        }
      };

      void runSpeechQueue();

      speechDelayTimeoutRef.current = null;
    }, speakDelayMs);

    return () => {
      if (speechDelayTimeoutRef.current !== null) {
        window.clearTimeout(speechDelayTimeoutRef.current);
        speechDelayTimeoutRef.current = null;
      }

      window.speechSynthesis.cancel();
    };
  }, [
    speechSupported,
    voiceEnabled,
    phase,
    currentTurn,
    turnIndex,
    isRevealing,
    masterVolume,
    playOpenAiLayeredSpeech,
    stopQuestionSpeech,
    triggerAlienAirwaveStun,
  ]);

  useEffect(() => {
    revealProgressRef.current = revealProgress;
  }, [revealProgress]);

  useEffect(() => {
    phaseRef.current = phase;

    if (phase === "ending") {
      const now = performance.now();
      endingCinematicRef.current = {
        stage: "room-shake-flash",
        stageStartedAt: now,
        blastStartedAt: 0,
        lastRumbleAt: 0,
      };
      endingBlackoutOpacityRef.current = 0;
      setEndingBlackoutOpacity(0);
      endingFlashOpacityRef.current = 0;
      setEndingFlashOpacity(0);
      endingPanelVisibleRef.current = false;
      setEndingPanelVisible(false);
      return;
    }

    endingCinematicRef.current = {
      stage: "inactive",
      stageStartedAt: 0,
      blastStartedAt: 0,
      lastRumbleAt: 0,
    };
    endingBlackoutOpacityRef.current = 0;
    setEndingBlackoutOpacity(0);
    endingFlashOpacityRef.current = 0;
    setEndingFlashOpacity(0);
    endingPanelVisibleRef.current = false;
    setEndingPanelVisible(false);
  }, [phase]);

  useEffect(() => {
    endingPanelVisibleRef.current = endingPanelVisible;
  }, [endingPanelVisible]);

  useEffect(() => {
    turnIndexRef.current = turnIndex;
  }, [turnIndex]);

  useEffect(() => {
    if (phase === "questions" && currentTurn) {
      currentQuestionCharsRef.current = currentTurn.alienLine.replace("Alien Vessel: ", "").length;
      return;
    }

    currentQuestionCharsRef.current = 0;
    typedQuestionCharsRef.current = 0;
  }, [phase, currentTurn]);

  useEffect(() => {
    typedQuestionCharsRef.current = typedAlienText.length;
  }, [typedAlienText]);

  useEffect(() => {
    isRevealingRef.current = isRevealing;
  }, [isRevealing]);

  useEffect(() => {
    const revealAudio = revealAudioRef.current;
    if (!revealAudio) {
      return;
    }

    if (!isRevealing) {
      revealAudio.pause();
      revealAudio.currentTime = 0;
      revealAudioStartedRef.current = false;
      return;
    }

    const fadeIn = Math.min(1, revealProgress / 0.22);
    const fadeOut = revealProgress > 0.62 ? Math.max(0, 1 - (revealProgress - 0.62) / 0.38) : 1;
    const envelope = fadeIn * fadeOut;
    revealAudio.volume = Math.min(1, masterVolumeRef.current * 0.42 * envelope);
  }, [isRevealing, revealProgress]);

  useEffect(() => {
    return () => {
      stopQuestionSpeech();
      clearPreparedSpeechCache();
      if (speechFxContextRef.current && speechFxContextRef.current.state !== "closed") {
        void speechFxContextRef.current.close();
      }
      speechFxContextRef.current = null;
      void stopShipHum();
    };
  }, [clearPreparedSpeechCache, stopQuestionSpeech, stopShipHum]);

  useEffect(() => {
    const mountEl = mountRef.current;
    if (!mountEl) return;

    const scene = new THREE.Scene();
    const introBackgroundColor = new THREE.Color("#010102");
    const gameplayBackgroundColor = new THREE.Color("#020309");
    const introFog = new THREE.Fog("#010102", 6.4, 17.5);
    const gameplayFog = new THREE.Fog("#05070c", 4.8, 15.5);
    scene.background = introBackgroundColor;
    scene.fog = introFog;

    const camera = new THREE.PerspectiveCamera(65, mountEl.clientWidth / mountEl.clientHeight, 0.1, 120);
    camera.position.set(0, 1.65, 5.1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountEl.appendChild(renderer.domElement);

    const ship = createSpaceshipInterior();
    scene.add(ship);
    ship.visible = false;
    const deepSpaceStars = ship.getObjectByName("deep-space-stars") as THREE.Points | null;
    const leftWindowEarth = ship.getObjectByName("left-window-earth") as THREE.Group | null;

    const {
      group: wallSymbolGroup,
      symbols: floatingWallSymbols,
      textures: floatingWallSymbolTextures,
    } = createFloatingWallSymbols();
    wallSymbolGroup.visible = false;
    scene.add(wallSymbolGroup);

    const introEarthGroup = new THREE.Group();
    const introEarthCenter = new THREE.Vector3(0, 1.48, -3.7);
    let introEarthModel: THREE.Object3D | null = null;
    let leftWindowEarthModel: THREE.Object3D | null = null;
    let introUfoModel: THREE.Object3D | null = null;
    const earth = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.32, 1),
      new THREE.MeshStandardMaterial({
        color: "#3d434c",
        roughness: 0.98,
        metalness: 0,
        emissive: "#040507",
        emissiveIntensity: 0.07,
      }),
    );
    earth.position.copy(introEarthCenter);
    introEarthGroup.add(earth);

    const cloudLayer = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.37, 1),
      new THREE.MeshStandardMaterial({
        color: "#9ea6b2",
        transparent: true,
        opacity: 0.06,
        roughness: 0.95,
        metalness: 0,
      }),
    );
    cloudLayer.position.copy(earth.position);
    introEarthGroup.add(cloudLayer);

    const starCount = 340;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      starPositions[i3] = (Math.random() - 0.5) * 30;
      starPositions[i3 + 1] = -4 + Math.random() * 13;
      starPositions[i3 + 2] = -7 - Math.random() * 10;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: "#c9cfdb",
        size: 0.072,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
      }),
    );

    scene.add(introEarthGroup);
    scene.add(stars);

    const ufoOrbitBaseOffset = new THREE.Vector3(2.15, 1.08, 0.15);
    const ufoOrbitPivot = new THREE.Object3D();
    ufoOrbitPivot.position.copy(introEarthCenter);
    scene.add(ufoOrbitPivot);

    const ufoAnchor = new THREE.Object3D();
    ufoAnchor.position.copy(ufoOrbitBaseOffset);
    ufoOrbitPivot.add(ufoAnchor);

    const introUfoLoader = new GLTFLoader();
    introUfoLoader.load(
      "/models/ufo_low_poly.glb",
      (gltf) => {
        introUfoModel = gltf.scene;

        const bounds = new THREE.Box3().setFromObject(introUfoModel);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bounds.getSize(size);
        bounds.getCenter(center);

        const longestAxis = Math.max(size.x, size.y, size.z, 0.0001);
        const targetDiameter = 0.82;
        const fitScale = targetDiameter / longestAxis;
        introUfoModel.scale.setScalar(fitScale);

        bounds.setFromObject(introUfoModel);
        bounds.getCenter(center);
        introUfoModel.position.set(-center.x, -center.y, -center.z);

        introUfoModel.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = false;
          mesh.receiveShadow = false;

          const applyUfoTuning = (material: THREE.Material) => {
            if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
              material.color = new THREE.Color("#c8ced8");
              material.roughness = 0.36;
              material.metalness = 0.62;
              material.emissive = new THREE.Color("#2a2f38");
              material.emissiveIntensity = 0.2;
            }
          };

          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => applyUfoTuning(material));
          } else if (mesh.material) {
            applyUfoTuning(mesh.material);
          }
        });

        ufoAnchor.add(introUfoModel);
      },
      undefined,
      () => {
        introUfoModel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.28, 0.09, 24),
          new THREE.MeshStandardMaterial({
            color: "#c8ced8",
            roughness: 0.36,
            metalness: 0.62,
            emissive: "#2a2f38",
            emissiveIntensity: 0.2,
          }),
        );
        introUfoModel.scale.setScalar(1.3);
        ufoAnchor.add(introUfoModel);
      },
    );

    const introEarthLoader = new GLTFLoader();
    const introEarthModelCandidates = ["/models/low_poly_earth.glb", "/models/earth.glb"];

    const applyEarthMaterialTuning = (material: THREE.Material) => {
      if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
        const materialName = material.name.toLowerCase();

        if (materialName.includes("water")) {
          material.color = new THREE.Color("#34557e");
          material.roughness = 0.95;
          material.metalness = 0;
        } else if (materialName.includes("earth")) {
          material.color = new THREE.Color("#4f5542");
          material.roughness = 0.99;
          material.metalness = 0;
        }

        material.roughness = Math.min(1, Math.max(0, material.roughness ?? 0.8));
        material.metalness = Math.min(1, Math.max(0, material.metalness ?? 0.05));
        material.emissiveIntensity = 0;
      }
    };

    const loadIntroEarthModel = (candidateIndex: number) => {
      if (candidateIndex >= introEarthModelCandidates.length) {
        introEarthModel = null;
        return;
      }

      introEarthLoader.load(
        introEarthModelCandidates[candidateIndex],
        (gltf) => {
        introEarthModel = gltf.scene;

        const bounds = new THREE.Box3().setFromObject(introEarthModel);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bounds.getSize(size);
        bounds.getCenter(center);

        const longestAxis = Math.max(size.x, size.y, size.z, 0.0001);
        const targetDiameter = 2.8;
        const fitScale = targetDiameter / longestAxis;
        introEarthModel.scale.setScalar(fitScale);

        bounds.setFromObject(introEarthModel);
        bounds.getCenter(center);

        introEarthModel.position.set(-center.x + introEarthCenter.x, -center.y + introEarthCenter.y, -center.z + introEarthCenter.z);

        introEarthModel.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = false;
          mesh.receiveShadow = false;

          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => applyEarthMaterialTuning(material));
          } else if (mesh.material) {
            applyEarthMaterialTuning(mesh.material);
          }
        });

          introEarthGroup.visible = false;
          scene.add(introEarthModel);

          if (leftWindowEarth) {
            if (leftWindowEarthModel) {
              leftWindowEarth.remove(leftWindowEarthModel);
            }

            leftWindowEarthModel = introEarthModel.clone(true);

            const windowBounds = new THREE.Box3().setFromObject(leftWindowEarthModel);
            const windowSize = new THREE.Vector3();
            const windowCenter = new THREE.Vector3();
            windowBounds.getSize(windowSize);
            windowBounds.getCenter(windowCenter);

            const windowLongestAxis = Math.max(windowSize.x, windowSize.y, windowSize.z, 0.0001);
            const windowTargetDiameter = 13.2;
            const windowFitScale = windowTargetDiameter / windowLongestAxis;
            leftWindowEarthModel.scale.setScalar(windowFitScale);

            windowBounds.setFromObject(leftWindowEarthModel);
            windowBounds.getCenter(windowCenter);
            leftWindowEarthModel.position.set(-windowCenter.x, -windowCenter.y, -windowCenter.z);

            leftWindowEarthModel.traverse((object) => {
              const mesh = object as THREE.Mesh;
              if (!mesh.isMesh) return;
              mesh.castShadow = false;
              mesh.receiveShadow = false;

              if (Array.isArray(mesh.material)) {
                mesh.material = mesh.material.map((material) => {
                  if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
                    const materialName = material.name.toLowerCase();
                    const tuned = material.clone();
                    tuned.fog = false;
                    if (materialName.includes("earth") || materialName.includes("land")) {
                      tuned.color = new THREE.Color("#5d7b48");
                    }
                    tuned.roughness = Math.max(0.92, tuned.roughness ?? 0.92);
                    tuned.metalness = 0;
                    tuned.envMapIntensity = 0.12;
                    if (tuned instanceof THREE.MeshPhysicalMaterial) {
                      tuned.clearcoat = 0;
                      tuned.clearcoatRoughness = 1;
                      tuned.sheen = 0;
                      tuned.transmission = 0;
                      tuned.ior = 1.2;
                    }
                    if (tuned.map) {
                      tuned.emissive = new THREE.Color("#ffffff");
                      tuned.emissiveMap = tuned.map;
                      tuned.emissiveIntensity = 0.07;
                    } else {
                      tuned.emissive = tuned.color.clone();
                      tuned.emissiveMap = null;
                      tuned.emissiveIntensity = 0.04;
                    }
                    return tuned;
                  }
                  return material;
                });
              } else if (mesh.material) {
                if (mesh.material instanceof THREE.MeshStandardMaterial || mesh.material instanceof THREE.MeshPhysicalMaterial) {
                  const materialName = mesh.material.name.toLowerCase();
                  const tuned = mesh.material.clone();
                  tuned.fog = false;
                  if (materialName.includes("earth") || materialName.includes("land")) {
                    tuned.color = new THREE.Color("#5d7b48");
                  }
                  tuned.roughness = Math.max(0.92, tuned.roughness ?? 0.92);
                  tuned.metalness = 0;
                  tuned.envMapIntensity = 0.12;
                  if (tuned instanceof THREE.MeshPhysicalMaterial) {
                    tuned.clearcoat = 0;
                    tuned.clearcoatRoughness = 1;
                    tuned.sheen = 0;
                    tuned.transmission = 0;
                    tuned.ior = 1.2;
                  }
                  if (tuned.map) {
                    tuned.emissive = new THREE.Color("#ffffff");
                    tuned.emissiveMap = tuned.map;
                    tuned.emissiveIntensity = 0.07;
                  } else {
                    tuned.emissive = tuned.color.clone();
                    tuned.emissiveMap = null;
                    tuned.emissiveIntensity = 0.04;
                  }
                  mesh.material = tuned;
                }
              }
            });

            leftWindowEarth.add(leftWindowEarthModel);
          }
        },
        undefined,
        () => {
          loadIntroEarthModel(candidateIndex + 1);
        },
      );
    };

    loadIntroEarthModel(0);

    const introAmbient = new THREE.AmbientLight("#a5aebe", 0.16);
    scene.add(introAmbient);

    const introRim = new THREE.DirectionalLight("#c7ced9", 0.52);
    introRim.position.set(3.1, 2.5, 2.1);
    scene.add(introRim);

    const introBack = new THREE.PointLight("#828a97", 0.2, 13.5, 2);
    introBack.position.set(-2.6, 1.1, -6.8);
    scene.add(introBack);

    const introFill = new THREE.DirectionalLight("#afb7c4", 0.22);
    introFill.position.set(-2.8, 1.8, 1.9);
    scene.add(introFill);

    const ufoGlow = new THREE.PointLight("#cfd6e4", 0.68, 5.2, 2);
    scene.add(ufoGlow);

    const endingExplosionFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 26, 26),
      new THREE.MeshBasicMaterial({
        color: "#fff3d0",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    endingExplosionFlash.position.copy(introEarthCenter);
    endingExplosionFlash.visible = false;
    scene.add(endingExplosionFlash);

    const endingExplosionLight = new THREE.PointLight("#ffd49a", 0, 8.5, 1.8);
    endingExplosionLight.position.copy(introEarthCenter);
    scene.add(endingExplosionLight);

    const ambient = new THREE.AmbientLight("#233754", 0.08);
    scene.add(ambient);

    const dimRim = new THREE.PointLight("#536f96", 0.14, 9, 2);
    dimRim.position.set(0, 4.28, 0);
    scene.add(dimRim);

    const ceilingGlowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 40),
      new THREE.MeshStandardMaterial({
        color: "#5f4b20",
        emissive: "#ffd46b",
        emissiveIntensity: 2.4,
        roughness: 0.2,
        metalness: 0,
      }),
    );
    ceilingGlowDisc.position.set(0, 4.28, 0);
    ceilingGlowDisc.rotation.x = Math.PI / 2;
    scene.add(ceilingGlowDisc);

    const ceilingGlowFrame = new THREE.Mesh(
      new THREE.TorusGeometry(0.79, 0.04, 12, 64),
      new THREE.MeshStandardMaterial({
        color: "#7a828e",
        roughness: 0.56,
        metalness: 0.44,
      }),
    );
    ceilingGlowFrame.position.set(0, 4.275, 0);
    ceilingGlowFrame.rotation.x = Math.PI / 2;
    scene.add(ceilingGlowFrame);

    const flashLight = new THREE.SpotLight("#c7c8cc", 10.8, 54, Math.PI * 0.125, 0.62, 0.82);
    const flashLightTarget = new THREE.Object3D();
    scene.add(flashLight);
    scene.add(flashLightTarget);
    flashLight.target = flashLightTarget;

    const flashFill = new THREE.PointLight("#c9c7bf", 0.2, 4, 1.9);
    scene.add(flashFill);

    const ceilingCoreLight = new THREE.PointLight("#ffd46b", 0.8, 6.2, 2.15);
    ceilingCoreLight.position.set(0, 3.62, 0);
    scene.add(ceilingCoreLight);

    const baseAmbientIntensity = 0.08;
    const baseDimRimIntensity = 0.14;
    const baseFlashIntensity = 10.8;
    const baseFlashFillIntensity = 0.2;
    const baseCeilingEmissiveIntensity = 2.4;
    const baseCeilingCoreLightIntensity = 0.8;
    const baseAmbientColor = new THREE.Color("#233754");
    const baseDimRimColor = new THREE.Color("#536f96");
    const baseFlashColor = new THREE.Color("#c7c8cc");
    const baseFlashFillColor = new THREE.Color("#c9c7bf");
    const baseCeilingEmissiveColor = new THREE.Color("#ffd46b");
    const baseCeilingCoreLightColor = new THREE.Color("#ffd46b");
    const alertAmbientColor = new THREE.Color("#45141a");
    const alertDimRimColor = new THREE.Color("#8f1f2b");
    const alertFlashColor = new THREE.Color("#ff5d68");
    const alertFlashFillColor = new THREE.Color("#d8444f");
    const alertCeilingEmissiveColor = new THREE.Color("#ff2b3e");
    const alertCeilingCoreLightColor = new THREE.Color("#ff2b3e");
    const affirmAmbientColor = new THREE.Color("#1a2742");
    const affirmDimRimColor = new THREE.Color("#2d4f8a");
    const affirmFlashColor = new THREE.Color("#6b97ff");
    const affirmFlashFillColor = new THREE.Color("#4f75c4");
    const ceilingGlowMaterial = ceilingGlowDisc.material as THREE.MeshStandardMaterial;
    let roomFlickerPulse = 1;
    let roomFlickerPulseTime = 0;
    let roomFlickerTimer = 0;
    let queuedDoubleFlickerAt = 0;
    let finalQuestionDimLevel = 0;
    let wallSymbolVisibility = 0;

    ambient.visible = false;
    dimRim.visible = false;
    ceilingGlowDisc.visible = false;
    ceilingGlowFrame.visible = false;
    flashLight.visible = false;
    flashFill.visible = false;
    ceilingCoreLight.visible = false;

    let alienRoot: THREE.Object3D | null = null;
    let alienBodyYaw = 0;
    let lastPlayerMoveAt = performance.now();
    const alienCollisionCenter = new THREE.Vector3(0, 0, 0);
    const alienLimbTimeUniforms: Array<{ value: number }> = [];
    const alienHeadTrackYawUniforms: Array<{ value: number }> = [];
    const alienHeadNoUniforms: Array<{ value: number }> = [];
    const alienHeadYesUniforms: Array<{ value: number }> = [];
    const alienArmTalkUniforms: Array<{ value: number }> = [];
    const alienHeadTalkUniforms: Array<{ value: number }> = [];
    let armTalkLevel = 0;
    const loader = new GLTFLoader();
    loader.load(
      "/models/alien.glb",
      (gltf) => {
        alienRoot = gltf.scene;

        const bounds = new THREE.Box3().setFromObject(alienRoot);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bounds.getSize(size);
        bounds.getCenter(center);

        if (size.y > 0) {
          const targetHeight = 2.25;
          const fitScale = targetHeight / size.y;
          alienRoot.scale.setScalar(fitScale);

          bounds.setFromObject(alienRoot);
          bounds.getCenter(center);
          const minY = bounds.min.y;

          const platformTopY = 0.28;
          alienRoot.position.set(-center.x, platformTopY - minY, -center.z);
          alienCollisionCenter.set(alienRoot.position.x, 0, alienRoot.position.z);
        } else {
          alienRoot.position.set(0, 0.3, 0);
          alienCollisionCenter.set(alienRoot.position.x, 0, alienRoot.position.z);
        }

        enableProceduralLimbMotion(
          alienRoot,
          alienLimbTimeUniforms,
          alienHeadTrackYawUniforms,
          alienHeadNoUniforms,
          alienHeadYesUniforms,
          alienArmTalkUniforms,
          alienHeadTalkUniforms,
        );
        alienBodyYaw = alienRoot.rotation.y;
        scene.add(alienRoot);
      },
      undefined,
      () => {
        const fallback = new THREE.Mesh(
          new THREE.SphereGeometry(0.8, 24, 20),
          new THREE.MeshStandardMaterial({ color: "#6ee9b8", roughness: 0.5, metalness: 0.1 }),
        );
        fallback.position.set(0, 1.2, 0);
        alienRoot = fallback;
        alienBodyYaw = fallback.rotation.y;
        alienCollisionCenter.set(fallback.position.x, 0, fallback.position.z);
        scene.add(fallback);
      },
    );

    const keys = new Set<string>();
    let isDragging = false;
    let yaw = 0;
    let pitch = -0.03;

    const playerPosition = new THREE.Vector3(0, 1.65, 5.1);
    const forwardDir = new THREE.Vector3();
    const rightDir = new THREE.Vector3();
    const movement = new THREE.Vector3();
    const desiredVelocity = new THREE.Vector3();
    const currentVelocity = new THREE.Vector3();
    const lookDir = new THREE.Vector3();
    const walkSpeed = 2.1;
    const acceleration = 6.5;
    const deceleration = 8.5;
    const playerRadius = 0.24;
    const roomWalkBoundaryRadius = 4.78;
    const alienCollisionRadius = 0.95;
    const tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");
    const eyeHeight = 1.65;
    const maxAlienHeadTrackYaw = THREE.MathUtils.degToRad(70);
    const alienBodyRecenterPauseMs = 1500;
    const alienBodyRecenterThreshold = THREE.MathUtils.degToRad(8);
    const alienBodyFollowTurnSpeed = 2.45;
    const alienBodyIdleRecenterSpeed = 1.75;
    let bobTime = 0;
    let bobOffset = 0;
    let bobIntensity = 0;
    let lastFootstepIndex = -1;

    camera.position.copy(playerPosition);
    tmpEuler.set(pitch, yaw, 0);
    camera.quaternion.setFromEuler(tmpEuler);

    const onKeyDown = (event: KeyboardEvent) => {
      if (phaseRef.current === "intro") return;
      keys.add(event.key.toLowerCase());
    };

    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.key.toLowerCase());
    };

    const onMouseDown = (event: MouseEvent) => {
      if (phaseRef.current === "intro") return;
      if (event.button !== 0) return;
      isDragging = true;
      mountEl.classList.add("is-dragging");
    };

    const onMouseUp = () => {
      isDragging = false;
      mountEl.classList.remove("is-dragging");
    };

    const onMouseMove = (event: MouseEvent) => {
      if (phaseRef.current === "intro") return;
      if (!isDragging) return;
      yaw -= event.movementX * 0.003;
      pitch -= event.movementY * 0.0022;
      pitch = Math.max(-Math.PI / 2.25, Math.min(Math.PI / 2.25, pitch));
    };

    let touchX = 0;
    let touchY = 0;
    let touchActive = false;

    const applyLookDelta = (dx: number, dy: number) => {
      yaw -= dx * 0.003;
      pitch -= dy * 0.0022;
      pitch = Math.max(-Math.PI / 2.25, Math.min(Math.PI / 2.25, pitch));
    };

    const onTouchStart = (event: TouchEvent) => {
      if (phaseRef.current === "intro") return;
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      touchActive = true;
      isDragging = true;
      touchX = touch.clientX;
      touchY = touch.clientY;
      mountEl.classList.add("is-dragging");
    };

    const onTouchMove = (event: TouchEvent) => {
      if (phaseRef.current === "intro") return;
      if (!touchActive || !isDragging) return;
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      const dx = touch.clientX - touchX;
      const dy = touch.clientY - touchY;
      touchX = touch.clientX;
      touchY = touch.clientY;
      applyLookDelta(dx, dy);
      event.preventDefault();
    };

    const onTouchEnd = () => {
      touchActive = false;
      isDragging = false;
      mountEl.classList.remove("is-dragging");
    };

    const onResize = () => {
      const { clientWidth, clientHeight } = mountEl;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    mountEl.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    mountEl.addEventListener("touchstart", onTouchStart, { passive: true });
    mountEl.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    const clock = new THREE.Clock();
    const introCameraPosition = new THREE.Vector3(0, 1.74, 4.72);
    const introLookTarget = new THREE.Vector3(0, 1.47, -3.7);
    const ufoWorldPosition = new THREE.Vector3();
    let buildupActive = false;
    let fallingShipActive = false;
    let shakingShipCuePlayed = false;
    let deepSpaceOrbitYaw = 0;
    let animationFrameId = 0;

    const animate = () => {
      const delta = Math.min(clock.getDelta(), 0.06);
      const elapsed = clock.getElapsedTime();
      const introMode = phaseRef.current === "intro";

      if (isRevealingRef.current) {
        const nextProgress = Math.min(1, revealProgressRef.current + delta / 3.1);
        if (nextProgress !== revealProgressRef.current) {
          revealProgressRef.current = nextProgress;
          setRevealProgress(nextProgress);
        }

        if (nextProgress >= 1) {
          isRevealingRef.current = false;
          setIsRevealing(false);
        }
      }

      if (introMode) {
        ship.visible = false;
        introEarthGroup.visible = !introEarthModel;
        if (introEarthModel) introEarthModel.visible = true;
        introAmbient.visible = true;
        introRim.visible = true;
        introBack.visible = true;
        introFill.visible = true;
        ufoGlow.visible = true;
        stars.visible = true;
        ufoOrbitPivot.visible = true;

        ambient.visible = false;
        dimRim.visible = false;
        ceilingGlowDisc.visible = false;
        ceilingGlowFrame.visible = false;
        flashLight.visible = false;
        flashFill.visible = false;
        ceilingCoreLight.visible = false;
        wallSymbolGroup.visible = false;
        if (alienRoot) alienRoot.visible = false;

        scene.background = introBackgroundColor;
        scene.fog = introFog;

        ambient.intensity = baseAmbientIntensity;
        dimRim.intensity = baseDimRimIntensity;
        flashLight.intensity = baseFlashIntensity;
        flashFill.intensity = baseFlashFillIntensity;
        ceilingGlowMaterial.emissiveIntensity = baseCeilingEmissiveIntensity;
        ceilingCoreLight.intensity = baseCeilingCoreLightIntensity;
        ambient.color.copy(baseAmbientColor);
        dimRim.color.copy(baseDimRimColor);
        flashLight.color.copy(baseFlashColor);
        flashFill.color.copy(baseFlashFillColor);
        ceilingGlowMaterial.emissive.copy(baseCeilingEmissiveColor);
        ceilingCoreLight.color.copy(baseCeilingCoreLightColor);
        endingExplosionFlash.visible = false;
        endingExplosionLight.intensity = 0;
        roomFlickerPulse = 1;
        roomFlickerPulseTime = 0;
        roomFlickerTimer = 0;
        finalQuestionDimLevel = 0;

        if (introEarthModel) {
          introEarthModel.rotation.y += delta * 0.045;
          introEarthModel.rotation.x = Math.sin(elapsed * 0.3) * 0.02;
        } else {
          earth.rotation.y += delta * 0.045;
          earth.rotation.x = Math.sin(elapsed * 0.37) * 0.035;
          cloudLayer.rotation.y += delta * 0.055;
          cloudLayer.rotation.x = Math.sin(elapsed * 0.42) * 0.018;
        }

        const ufoBobOffset = Math.sin(elapsed * 1.15) * 0.08;
        ufoOrbitPivot.rotation.y += delta * 0.045;
        ufoAnchor.position.set(ufoOrbitBaseOffset.x, ufoOrbitBaseOffset.y + ufoBobOffset, ufoOrbitBaseOffset.z);
        ufoAnchor.lookAt(0, 0, 0);
        ufoAnchor.getWorldPosition(ufoWorldPosition);
        ufoGlow.position.copy(ufoWorldPosition);

        isDragging = false;
        mountEl.classList.remove("is-dragging");
        currentVelocity.set(0, 0, 0);
        camera.position.copy(introCameraPosition);
        if (Math.abs(camera.fov - 65) > 0.01) {
          camera.fov = THREE.MathUtils.lerp(camera.fov, 65, 0.22);
          camera.updateProjectionMatrix();
        }
        camera.lookAt(introLookTarget);

        renderer.render(scene, camera);
        animationFrameId = requestAnimationFrame(animate);
        return;
      }

      if (deepSpaceStars) {
        deepSpaceOrbitYaw += delta * 0.006;
        deepSpaceStars.rotation.y = deepSpaceOrbitYaw;
        deepSpaceStars.rotation.x = 0.11 + Math.sin(elapsed * 0.009) * 0.012;
        deepSpaceStars.rotation.z = -0.08 + Math.sin(elapsed * 0.0084 + 0.7) * 0.01;
        deepSpaceStars.position.x = Math.sin(elapsed * 0.024) * 0.12;
        deepSpaceStars.position.y = Math.sin(elapsed * 0.018 + 0.8) * 0.08;
        deepSpaceStars.position.z = Math.sin(elapsed * 0.021 + 1.4) * 0.1;
      }

      if (leftWindowEarth) {
        const orbitRadius = (leftWindowEarth.userData.orbitRadius as number | undefined) ?? 62;
        const orbitStartAngle = (leftWindowEarth.userData.orbitStartAngle as number | undefined) ?? Math.PI;
        const orbitY = (leftWindowEarth.userData.orbitY as number | undefined) ?? 2.41;
        const orbitSpeed = (leftWindowEarth.userData.orbitSpeed as number | undefined) ?? 0.0066;
        const orbitAngle = orbitStartAngle - elapsed * orbitSpeed;
        leftWindowEarth.position.x = Math.cos(orbitAngle) * orbitRadius;
        leftWindowEarth.position.z = Math.sin(orbitAngle) * orbitRadius;
        leftWindowEarth.position.y = orbitY + Math.sin(elapsed * 0.0198 + 0.35) * 0.22;
        leftWindowEarth.rotation.y += delta * 0.07;
        leftWindowEarth.rotation.x = Math.sin(elapsed * 0.12) * 0.03;
      }

      const endingMode = phaseRef.current === "ending";
      const endingSequence = endingCinematicRef.current;
      const endingSavedOutcome = endingSavedOutcomeRef.current;
      const endingStage = endingSequence.stage;
      const shouldBuildupBeActive =
        endingMode && (endingStage === "room-shake-flash" || endingStage === "fade-room-black");

      if (shouldBuildupBeActive !== buildupActive) {
        buildupActive = shouldBuildupBeActive;
        const buildup = buildupAudioRef.current;
        if (buildup) {
          if (shouldBuildupBeActive) {
            clearTrackPauseTimeout(buildupPauseTimeoutRef);
            try {
              buildup.currentTime = BUILDUP_TRIM_OFFSET_SECONDS;
            } catch {
              buildup.currentTime = 0;
            }
            const playAttempt = buildup.play();
            if (playAttempt && typeof playAttempt.then === "function") {
              void playAttempt
                .then(() => {
                  fadeBuildupTo(1, 1800);
                })
                .catch(() => {
                  return;
                });
            } else {
              fadeBuildupTo(1, 1800);
            }
          } else {
            fadeBuildupTo(0, 650);
            clearTrackPauseTimeout(buildupPauseTimeoutRef);
            buildupPauseTimeoutRef.current = window.setTimeout(() => {
              buildupPauseTimeoutRef.current = null;

              const liveStage = endingCinematicRef.current.stage;
              const shouldStillPlay =
                phaseRef.current === "ending" &&
                (liveStage === "room-shake-flash" || liveStage === "fade-room-black");
              if (shouldStillPlay) {
                return;
              }

              const latestBuildup = buildupAudioRef.current;
              if (!latestBuildup) {
                return;
              }

              latestBuildup.pause();
              latestBuildup.currentTime = 0;
            }, 720);
          }
        }
      }

      if (shouldBuildupBeActive !== fallingShipActive) {
        fallingShipActive = shouldBuildupBeActive;
        const fallingShip = fallingShipAudioRef.current;
        if (fallingShip) {
          if (fallingShipActive) {
            clearTrackPauseTimeout(fallingShipPauseTimeoutRef);
            try {
              fallingShip.currentTime = 0;
            } catch {
              fallingShip.currentTime = 0;
            }
            const playAttempt = fallingShip.play();
            if (playAttempt && typeof playAttempt.then === "function") {
              void playAttempt
                .then(() => {
                  fadeFallingShipTo(1, 1800);
                })
                .catch(() => {
                  return;
                });
            } else {
              fadeFallingShipTo(1, 1800);
            }
          } else {
            fadeFallingShipTo(0, 650);
            clearTrackPauseTimeout(fallingShipPauseTimeoutRef);
            fallingShipPauseTimeoutRef.current = window.setTimeout(() => {
              fallingShipPauseTimeoutRef.current = null;

              const liveStage = endingCinematicRef.current.stage;
              const shouldStillPlay =
                phaseRef.current === "ending" &&
                (liveStage === "room-shake-flash" || liveStage === "fade-room-black");
              if (shouldStillPlay) {
                return;
              }

              const latestFallingShip = fallingShipAudioRef.current;
              if (!latestFallingShip) {
                return;
              }

              latestFallingShip.pause();
              latestFallingShip.currentTime = 0;
            }, 720);
          }
        }
      }

      if (shouldBuildupBeActive && !shakingShipCuePlayed) {
        shakingShipCuePlayed = true;
        playShakingShipCue();
      } else if (!shouldBuildupBeActive) {
        shakingShipCuePlayed = false;
      }

      const isEndingRoomStage = endingMode && (endingStage === "room-shake-flash" || endingStage === "fade-room-black");
      const isEndingWorldStage =
        endingMode &&
        (endingStage === "show-saved" ||
          endingStage === "show-destroyed-earth" ||
          endingStage === "show-destroyed-engulf" ||
          endingStage === "destroyed-fade-black" ||
          endingStage === "complete");
      const isEndingDestroyedWorld =
        endingMode &&
        (endingStage === "show-destroyed-earth" ||
          endingStage === "show-destroyed-engulf" ||
          endingStage === "destroyed-fade-black");

      if (endingMode) {
        const now = performance.now();
        let nextBlackout = endingBlackoutOpacityRef.current;
        let nextFlash = endingFlashOpacityRef.current;
        const stageElapsed = (now - endingSequence.stageStartedAt) / 1000;

        if (endingStage === "room-shake-flash") {
          nextBlackout = Math.max(0, nextBlackout - delta / 0.45);
          nextFlash = 0;

          if (stageElapsed >= 2.0) {
            endingSequence.stage = "fade-room-black";
            endingSequence.stageStartedAt = now;
          }
        } else if (endingStage === "fade-room-black") {
          nextFlash = 0;
          nextBlackout = Math.min(1, nextBlackout + delta / 1.45);
          if (nextBlackout >= 0.995) {
            void stopShipHum();
            endingSequence.stage = endingSavedOutcome ? "show-saved" : "show-destroyed-earth";
            endingSequence.stageStartedAt = now;
            endingSequence.blastStartedAt = 0;
            endingSequence.lastRumbleAt = 0;
          }
        } else if (endingStage === "show-saved") {
          nextBlackout = Math.max(0, nextBlackout - delta / 1.35);
          nextFlash = Math.max(0, nextFlash - delta / 0.5);
          if (stageElapsed >= 2.8 && !endingPanelVisibleRef.current) {
            endingPanelVisibleRef.current = true;
            setEndingPanelVisible(true);
            endingSequence.stage = "complete";
            endingSequence.stageStartedAt = now;
          }
        } else if (endingStage === "show-destroyed-earth") {
          nextBlackout = Math.max(0, nextBlackout - delta / 1.15);
          nextFlash = Math.max(0, nextFlash - delta / 0.35);

          if (stageElapsed >= 1.0 && endingSequence.blastStartedAt <= 0) {
            endingSequence.blastStartedAt = now;
            endingSequence.lastRumbleAt = now;
            playEndingRumbleOneShot();
            playDistantExplosionOneShot();
            endingSequence.stage = "show-destroyed-engulf";
            endingSequence.stageStartedAt = now;
          }
        } else if (endingStage === "show-destroyed-engulf") {
          nextBlackout = Math.max(0, nextBlackout - delta / 0.55);
          nextFlash = Math.min(1, nextFlash + delta / 0.34);

          if (endingSequence.blastStartedAt > 0) {
            const sinceBlast = now - endingSequence.blastStartedAt;
            if (sinceBlast - endingSequence.lastRumbleAt >= 340) {
              endingSequence.lastRumbleAt = now;
              playEndingRumbleOneShot();
            }

            if (sinceBlast >= 1000) {
              endingSequence.stage = "destroyed-fade-black";
              endingSequence.stageStartedAt = now;
            }
          }
        } else if (endingStage === "destroyed-fade-black") {
          nextFlash = Math.max(0, nextFlash - delta / 1.15);
          nextBlackout = Math.min(1, nextBlackout + delta / 0.92);
          if (nextBlackout >= 0.995 && !endingPanelVisibleRef.current) {
            endingPanelVisibleRef.current = true;
            setEndingPanelVisible(true);
            endingSequence.stage = "complete";
            endingSequence.stageStartedAt = now;
          }
        } else if (endingStage === "complete") {
          nextFlash = Math.max(0, nextFlash - delta / 0.45);
        }

        if (Math.abs(nextBlackout - endingBlackoutOpacityRef.current) > 0.0015) {
          endingBlackoutOpacityRef.current = nextBlackout;
          setEndingBlackoutOpacity(nextBlackout);
        }

        if (Math.abs(nextFlash - endingFlashOpacityRef.current) > 0.0015) {
          endingFlashOpacityRef.current = nextFlash;
          setEndingFlashOpacity(nextFlash);
        }
      }

      if (isEndingWorldStage) {
        ship.visible = false;
        introEarthGroup.visible = !introEarthModel;
        if (introEarthModel) introEarthModel.visible = true;
        introAmbient.visible = true;
        introRim.visible = true;
        introBack.visible = true;
        introFill.visible = true;
        ufoGlow.visible = false;
        stars.visible = true;
        ufoOrbitPivot.visible = false;

        ambient.visible = false;
        dimRim.visible = false;
        ceilingGlowDisc.visible = false;
        ceilingGlowFrame.visible = false;
        flashLight.visible = false;
        flashFill.visible = false;
        wallSymbolGroup.visible = false;
        if (alienRoot) alienRoot.visible = false;

        scene.background = introBackgroundColor;
        scene.fog = introFog;

        const worldBob = Math.sin(elapsed * 0.36);
        const earthShakeAmount =
          endingStage === "show-destroyed-earth"
            ? 0.055 + (Math.sin(elapsed * 33.0) * 0.5 + 0.5) * 0.02
            : endingStage === "show-destroyed-engulf"
              ? 0.072
              : 0;
        if (introEarthModel) {
          introEarthModel.rotation.y += delta * 0.052;
          introEarthModel.rotation.x = worldBob * 0.023 + Math.sin(elapsed * 26.0) * earthShakeAmount;
          introEarthModel.rotation.z = Math.sin(elapsed * 31.0) * earthShakeAmount * 0.82;
        } else {
          earth.visible = true;
          cloudLayer.visible = true;
          earth.rotation.y += delta * 0.048;
          earth.rotation.x = worldBob * 0.03 + Math.sin(elapsed * 26.0) * earthShakeAmount;
          earth.rotation.z = Math.sin(elapsed * 31.0) * earthShakeAmount * 0.82;
          cloudLayer.rotation.y += delta * 0.057;
          cloudLayer.rotation.x = Math.sin(elapsed * 0.42) * 0.018;
        }

        const worldUfoBob = Math.sin(elapsed * 0.98) * 0.07;
        ufoOrbitPivot.rotation.y += delta * 0.038;
        ufoAnchor.position.set(ufoOrbitBaseOffset.x, ufoOrbitBaseOffset.y + worldUfoBob, ufoOrbitBaseOffset.z);
        ufoAnchor.lookAt(0, 0, 0);
        ufoAnchor.getWorldPosition(ufoWorldPosition);
        ufoGlow.position.copy(ufoWorldPosition);
      } else {
        ship.visible = true;
        introEarthGroup.visible = false;
        if (introEarthModel) introEarthModel.visible = false;
        introAmbient.visible = false;
        introRim.visible = false;
        introBack.visible = false;
        introFill.visible = false;
        ufoGlow.visible = false;
        stars.visible = false;
        ufoOrbitPivot.visible = false;

        ambient.visible = true;
        dimRim.visible = true;
        ceilingGlowDisc.visible = true;
        ceilingGlowFrame.visible = true;
        flashLight.visible = true;
        flashFill.visible = true;
        ceilingCoreLight.visible = true;
        wallSymbolGroup.visible = wallSymbolVisibility > 0.01;
        if (alienRoot) alienRoot.visible = true;

        scene.background = gameplayBackgroundColor;
        scene.fog = gameplayFog;
      }

      roomFlickerTimer -= delta;
      roomFlickerPulseTime = Math.max(0, roomFlickerPulseTime - delta);

      const nowMs = performance.now();
      if (queuedDoubleFlickerAt > 0 && nowMs >= queuedDoubleFlickerAt) {
        roomFlickerPulse = 0.8 + Math.random() * 0.12;
        roomFlickerPulseTime = 0.018 + Math.random() * 0.026;
        queuedDoubleFlickerAt = 0;
        playFlickerZapOneShot();
      }

      if (roomFlickerTimer <= 0) {
        const isLongFlicker = Math.random() < 0.3;
        const isDoubleFlicker = Math.random() < 0.2;
        roomFlickerPulse = 0.78 + Math.random() * 0.14;
        roomFlickerPulseTime = isLongFlicker ? 0.065 + Math.random() * 0.07 : 0.022 + Math.random() * 0.035;
        roomFlickerTimer = 2.3 + Math.random() * 4.4;
        queuedDoubleFlickerAt = isDoubleFlicker ? nowMs + 70 + Math.random() * 90 : 0;
        playFlickerZapOneShot();
      }

      const roomLightFactor = roomFlickerPulseTime > 0 ? roomFlickerPulse : 1;
      const ceilingFlickerFactor = roomFlickerPulseTime > 0 ? THREE.MathUtils.clamp(roomFlickerPulse * 0.42, 0.24, 0.42) : 1;

      const isFinalQuestionActive = phaseRef.current === "questions" && turnIndexRef.current === QUESTION_CONTENT.length - 1;
      const isGeometricSymbolsQuestionActive =
        phaseRef.current === "questions" &&
        turnIndexRef.current === GEOMETRIC_SYMBOLS_TURN_INDEX &&
        !isRevealingRef.current;
      const wallSymbolTargetVisibility = isGeometricSymbolsQuestionActive ? 1 : 0;
      const wallSymbolFadeRate = wallSymbolTargetVisibility > wallSymbolVisibility ? 1.15 : 1.9;
      const wallSymbolFadeLerp = 1 - Math.exp(-delta * wallSymbolFadeRate);
      wallSymbolVisibility = THREE.MathUtils.lerp(wallSymbolVisibility, wallSymbolTargetVisibility, wallSymbolFadeLerp);
      wallSymbolGroup.visible = wallSymbolVisibility > 0.01;
      const wallSymbolFadeInShakeAmount =
        wallSymbolTargetVisibility > 0 && wallSymbolVisibility < 0.995 ? (1 - wallSymbolVisibility) * 0.06 : 0;
      const questionLength = Math.max(currentQuestionCharsRef.current, 1);
      const typedProgress = THREE.MathUtils.clamp(typedQuestionCharsRef.current / questionLength, 0, 1);
      const isSpeechLayerPlaying = speechAudioLayersRef.current.some(
        (layer) => !layer.audio.paused && !layer.audio.ended,
      );
      const isSynthSpeaking = speechSupported && window.speechSynthesis.speaking;
      const isTtsActive = isSpeechLayerPlaying || isSynthSpeaking;
      const isAlienTalking =
        phaseRef.current === "questions" &&
        !isRevealingRef.current &&
        ((currentQuestionCharsRef.current > 0 &&
          typedQuestionCharsRef.current > 0 &&
          typedQuestionCharsRef.current < currentQuestionCharsRef.current) ||
          isTtsActive);
      const talkTarget = isAlienTalking ? 1 : 0;
      const talkRate = talkTarget > armTalkLevel ? 3.2 : 1.6;
      const talkLerp = 1 - Math.exp(-delta * talkRate);
      armTalkLevel = THREE.MathUtils.lerp(armTalkLevel, talkTarget, talkLerp);
      const delayedFadeProgress = THREE.MathUtils.clamp((typedProgress - 0.72) / 0.28, 0, 1);
      const dimTarget = isEndingRoomStage ? 1 : isFinalQuestionActive ? delayedFadeProgress : 0;
      const dimLerp = 1 - Math.exp(-delta * (isFinalQuestionActive || isEndingRoomStage ? 1.1 : 3.4));
      finalQuestionDimLevel = THREE.MathUtils.lerp(finalQuestionDimLevel, dimTarget, dimLerp);
      const finalQuestionLightFactor = 1 - finalQuestionDimLevel * 0.52;
      const headReactionNow = performance.now();
      const headReactionMode = headReactionModeRef.current;
      const headReactionDurationMs = Math.max(1, headJoltEndsAtRef.current - headReactionStartedAtRef.current);
      const headReactionProgress = THREE.MathUtils.clamp(
        (headReactionNow - headReactionStartedAtRef.current) / headReactionDurationMs,
        0,
        1,
      );
      const headReactionEnvelope =
        headReactionNow < headJoltEndsAtRef.current ? Math.sin(headReactionProgress * Math.PI) : 0;
      const isHeadNoReactionActive = headReactionEnvelope > 0 && headReactionMode === "no";
      const isHeadYesReactionActive = headReactionEnvelope > 0 && headReactionMode === "yes";

      ambient.intensity = baseAmbientIntensity * roomLightFactor * finalQuestionLightFactor;
      dimRim.intensity = baseDimRimIntensity * roomLightFactor * finalQuestionLightFactor;
      flashLight.intensity = baseFlashIntensity * roomLightFactor * finalQuestionLightFactor;
      flashFill.intensity = baseFlashFillIntensity * roomLightFactor * finalQuestionLightFactor;
      ceilingGlowMaterial.emissiveIntensity =
        baseCeilingEmissiveIntensity * ceilingFlickerFactor * (1 - finalQuestionDimLevel * 0.66);
      ceilingCoreLight.intensity =
        baseCeilingCoreLightIntensity * ceilingFlickerFactor * (1 - finalQuestionDimLevel * 0.54);

      ambient.color.copy(baseAmbientColor).lerp(alertAmbientColor, finalQuestionDimLevel);
      dimRim.color.copy(baseDimRimColor).lerp(alertDimRimColor, finalQuestionDimLevel);
      flashLight.color.copy(baseFlashColor).lerp(alertFlashColor, finalQuestionDimLevel);
      flashFill.color.copy(baseFlashFillColor).lerp(alertFlashFillColor, finalQuestionDimLevel);
      ceilingGlowMaterial.emissive.copy(baseCeilingEmissiveColor).lerp(alertCeilingEmissiveColor, finalQuestionDimLevel);
      ceilingCoreLight.color.copy(baseCeilingCoreLightColor).lerp(alertCeilingCoreLightColor, finalQuestionDimLevel);

      if (isEndingWorldStage) {
        endingExplosionFlash.visible = false;
        endingExplosionLight.intensity = 0;
      }

      if (endingStage === "show-destroyed-earth") {
        endingExplosionLight.intensity = 2.3 + (Math.sin(elapsed * 14.0) * 0.5 + 0.5) * 2.2;
      }

      if ((endingStage === "show-destroyed-engulf" || endingStage === "destroyed-fade-black") && endingSequence.blastStartedAt > 0) {
        const sinceBlastMs = performance.now() - endingSequence.blastStartedAt;
        const explosionSeconds = sinceBlastMs / 1000;
        const blastPeak = THREE.MathUtils.clamp(explosionSeconds / 0.34, 0, 1);
        const blastDecay = THREE.MathUtils.clamp((explosionSeconds - 0.34) / 1.45, 0, 1);
        const blastEnvelope = blastPeak * (1 - blastDecay * 0.92);

        endingExplosionFlash.visible = blastEnvelope > 0.01;
        endingExplosionFlash.scale.setScalar(1 + explosionSeconds * 5.2);
        const flashMaterial = endingExplosionFlash.material as THREE.MeshBasicMaterial;
        flashMaterial.opacity = THREE.MathUtils.clamp(blastEnvelope * 0.92, 0, 0.92);
        endingExplosionLight.intensity = 2.4 + blastEnvelope * 12.5;

        const earthVisibility = explosionSeconds < 1.0;
        if (introEarthModel) {
          introEarthModel.visible = earthVisibility;
        } else {
          earth.visible = earthVisibility;
          cloudLayer.visible = earthVisibility;
        }
      }

      if (!isEndingDestroyedWorld && endingSequence.blastStartedAt > 0) {
        endingSequence.blastStartedAt = 0;
      }

      movement.set(0, 0, 0);

      forwardDir.set(Math.sin(yaw), 0, Math.cos(yaw));
      rightDir.set(Math.cos(yaw), 0, -Math.sin(yaw));

      const allowMovement = phaseRef.current === "questions";
      if (allowMovement && keys.has("w")) movement.addScaledVector(forwardDir, -1);
      if (allowMovement && keys.has("s")) movement.addScaledVector(forwardDir, 1);
      if (allowMovement && keys.has("a")) movement.addScaledVector(rightDir, -1);
      if (allowMovement && keys.has("d")) movement.addScaledVector(rightDir, 1);

      const hasInput = movement.lengthSq() > 0;
      if (hasInput) {
        desiredVelocity.copy(movement.normalize()).multiplyScalar(walkSpeed);
      } else {
        desiredVelocity.set(0, 0, 0);
      }

      const velocityLerp = 1 - Math.exp(-delta * (hasInput ? acceleration : deceleration));
      currentVelocity.lerp(desiredVelocity, velocityLerp);
      playerPosition.addScaledVector(currentVelocity, delta);

      const speedRatio = THREE.MathUtils.clamp(currentVelocity.length() / walkSpeed, 0, 1);
      const isMoving = speedRatio > 0.05;

      if (isMoving) {
        lastPlayerMoveAt = performance.now();
      }

      if (alienRoot) {
        const alienDx = playerPosition.x - alienCollisionCenter.x;
        const alienDz = playerPosition.z - alienCollisionCenter.z;
        const minAlienDistance = alienCollisionRadius + playerRadius;
        const alienDistance = Math.hypot(alienDx, alienDz);

        if (alienDistance < minAlienDistance) {
          const safeDistance = Math.max(alienDistance, 0.0001);
          const pushScale = minAlienDistance / safeDistance;
          playerPosition.x = alienCollisionCenter.x + alienDx * pushScale;
          playerPosition.z = alienCollisionCenter.z + alienDz * pushScale;
        }
      }

      const planarLength = Math.hypot(playerPosition.x, playerPosition.z);
      if (planarLength > roomWalkBoundaryRadius) {
        const scale = roomWalkBoundaryRadius / planarLength;
        playerPosition.x *= scale;
        playerPosition.z *= scale;
      }

      const bobIntensityTarget = isMoving ? speedRatio : 0;
      const bobIntensityLerp = 1 - Math.exp(-delta * (isMoving ? 8.5 : 2.1));
      bobIntensity = THREE.MathUtils.lerp(bobIntensity, bobIntensityTarget, bobIntensityLerp);

      bobTime += delta * (1.95 + bobIntensity * 2.2);
      const stomp = -Math.pow(Math.abs(Math.sin(bobTime)), 1.45);
      const bobAmplitude = (0.034 + bobIntensity * 0.056) * bobIntensity;
      bobOffset = stomp * bobAmplitude;

      if (isMoving && phaseRef.current === "questions") {
        const footstepIndex = Math.floor((bobTime + Math.PI * 0.5) / Math.PI);
        if (lastFootstepIndex === -1) {
          lastFootstepIndex = footstepIndex;
        } else if (footstepIndex !== lastFootstepIndex) {
          lastFootstepIndex = footstepIndex;
          playFootstepOneShot();
        }
      } else {
        lastFootstepIndex = -1;
      }

      let shakePosX = 0;
      let shakePosY = 0;
      let shakePosZ = 0;
      let shakeYaw = 0;
      let shakePitch = 0;

      if (isRevealingRef.current) {
        const shakeEnvelope = Math.max(0, 1 - revealProgressRef.current);
        const baseShake = 0.07 * shakeEnvelope;

        shakePosX += Math.sin(elapsed * 34.0) * baseShake * 0.5;
        shakePosY += Math.sin(elapsed * 49.0) * baseShake * 0.3;
        shakePosZ += Math.sin(elapsed * 29.0) * baseShake * 0.4;
        shakeYaw += Math.sin(elapsed * 37.0) * baseShake * 0.1;
        shakePitch += Math.sin(elapsed * 41.0) * baseShake * 0.075;
      }

      if (endingStage === "room-shake-flash" || endingStage === "fade-room-black") {
        const endingShake = 0.11;
        shakePosX += Math.sin(elapsed * 26.4) * endingShake * 0.54;
        shakePosY += Math.sin(elapsed * 33.7) * endingShake * 0.32;
        shakePosZ += Math.sin(elapsed * 29.8) * endingShake * 0.44;
        shakeYaw += Math.sin(elapsed * 31.2) * endingShake * 0.14;
        shakePitch += Math.sin(elapsed * 36.1) * endingShake * 0.11;

        const flashBeat = Math.sin(elapsed * 19.5) * 0.5 + 0.5;
        const redWhiteMix = flashBeat;
        ambient.color.copy(alertAmbientColor).lerp(baseAmbientColor, redWhiteMix);
        dimRim.color.copy(alertDimRimColor).lerp(baseDimRimColor, redWhiteMix);
        flashLight.color.copy(alertFlashColor).lerp(baseFlashColor, redWhiteMix);
        flashFill.color.copy(alertFlashFillColor).lerp(baseFlashFillColor, redWhiteMix);
        ceilingGlowMaterial.emissive.copy(alertCeilingEmissiveColor).lerp(baseCeilingEmissiveColor, redWhiteMix);
      }

      if (!isEndingWorldStage && isHeadNoReactionActive) {
        const noShakeCameraJitter = 0.002 * headReactionEnvelope;
        shakePosX += Math.sin(elapsed * 60.0) * noShakeCameraJitter * 0.72;
        shakePosY += Math.sin(elapsed * 74.0 + 0.9) * noShakeCameraJitter * 0.44;
        shakePosZ += Math.sin(elapsed * 66.0 + 1.4) * noShakeCameraJitter * 0.52;
        shakeYaw +=
          headJoltDirectionRef.current * Math.sin(headReactionProgress * Math.PI * 4.2) * 0.011 * headReactionEnvelope;
        shakePitch += Math.sin(elapsed * 68.0 + 0.4) * 0.0048 * headReactionEnvelope;

        const noFlashPulse = Math.sin(elapsed * 24.0) * 0.5 + 0.5;
        const noFlashMix = (0.18 + noFlashPulse * 0.2) * headReactionEnvelope;
        const noCeilingFlashMix = Math.min(1, noFlashMix * 2.6);
        ambient.color.lerp(alertAmbientColor, noFlashMix);
        dimRim.color.lerp(alertDimRimColor, noFlashMix);
        flashLight.color.lerp(alertFlashColor, noFlashMix);
        flashFill.color.lerp(alertFlashFillColor, noFlashMix);
        ceilingGlowMaterial.emissive.lerp(alertCeilingEmissiveColor, noCeilingFlashMix);
        ceilingCoreLight.color.lerp(alertCeilingCoreLightColor, noFlashMix);
        ceilingCoreLight.intensity += baseCeilingCoreLightIntensity * noFlashMix * 0.28;
      }

      if (!isEndingWorldStage && isHeadYesReactionActive) {
        const yesFlashEnvelope = Math.pow(headReactionEnvelope, 0.78);
        const yesFlashMix = 0.56 * yesFlashEnvelope;
        const yesCeilingFlashMix = Math.min(1, yesFlashMix * 1.8);
        ambient.color.lerp(affirmAmbientColor, yesFlashMix);
        dimRim.color.lerp(affirmDimRimColor, yesFlashMix);
        flashLight.color.lerp(affirmFlashColor, yesFlashMix);
        flashFill.color.lerp(affirmFlashFillColor, yesFlashMix);
        ceilingGlowMaterial.emissive.lerp(affirmFlashColor, yesCeilingFlashMix);
        ceilingCoreLight.color.lerp(affirmFlashColor, yesFlashMix);
        ceilingCoreLight.intensity += baseCeilingCoreLightIntensity * yesFlashMix * 0.24;
      }

      const stunNow = performance.now();
      if (stunNow < stunEndsAtRef.current) {
        const stunDurationMs = Math.max(1, stunEndsAtRef.current - stunStartedAtRef.current);
        const stunProgress = THREE.MathUtils.clamp((stunNow - stunStartedAtRef.current) / stunDurationMs, 0, 1);
        const stunEnvelope = Math.sin(stunProgress * Math.PI);
        const stunIntensity = stunIntensityRef.current;

        shakePosX += Math.sin(elapsed * 24.5) * 0.0247 * stunEnvelope * stunIntensity;
        shakePosY += Math.sin(elapsed * 31.4) * 0.0143 * stunEnvelope * stunIntensity;
        shakePosZ += Math.sin(elapsed * 27.8) * 0.01625 * stunEnvelope * stunIntensity;
        shakeYaw += Math.sin(elapsed * 28.6) * 0.0377 * stunEnvelope * stunIntensity;
        shakePitch += Math.sin(elapsed * 33.7) * 0.026 * stunEnvelope * stunIntensity;

        const targetFov =
          65 + stunEnvelope * 4.2 * stunIntensity + Math.sin(elapsed * 10.2) * 0.9 * stunEnvelope * stunIntensity;
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.34);
        camera.updateProjectionMatrix();
      } else if (Math.abs(camera.fov - 65) > 0.01) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, 65, 0.18);
        camera.updateProjectionMatrix();
      }

      if (isEndingDestroyedWorld && endingSequence.blastStartedAt > 0) {
        const blastSeconds = (performance.now() - endingSequence.blastStartedAt) / 1000;
        const shakeEnvelope = THREE.MathUtils.clamp(1 - blastSeconds / 2.5, 0, 1);
        shakePosX += Math.sin(elapsed * 42.3) * 0.11 * shakeEnvelope;
        shakePosY += Math.sin(elapsed * 56.8) * 0.07 * shakeEnvelope;
        shakePosZ += Math.sin(elapsed * 48.7) * 0.09 * shakeEnvelope;
        shakeYaw += Math.sin(elapsed * 39.4) * 0.16 * shakeEnvelope;
        shakePitch += Math.sin(elapsed * 45.2) * 0.12 * shakeEnvelope;

        const targetFov = 65 + 9 * shakeEnvelope;
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.23);
        camera.updateProjectionMatrix();
      }

      if (isEndingWorldStage) {
        currentVelocity.set(0, 0, 0);
        camera.position.set(
          introCameraPosition.x + shakePosX,
          introCameraPosition.y + shakePosY,
          introCameraPosition.z + shakePosZ,
        );
        camera.lookAt(introLookTarget);
      } else {
        camera.position.set(playerPosition.x + shakePosX, eyeHeight + bobOffset + shakePosY, playerPosition.z + shakePosZ);
        tmpEuler.set(pitch + shakePitch, yaw + shakeYaw, 0);
        camera.quaternion.setFromEuler(tmpEuler);
      }

      camera.getWorldDirection(lookDir);
      flashLight.position.copy(camera.position);
      flashLightTarget.position.copy(camera.position).addScaledVector(lookDir, 6.2);
      flashFill.position.copy(camera.position).addScaledVector(lookDir, 0.65);

      if (alienRoot) {
        for (const uniform of alienLimbTimeUniforms) {
          uniform.value = elapsed;
        }

        const desiredBodyYaw = Math.atan2(
          playerPosition.x - alienRoot.position.x,
          playerPosition.z - alienRoot.position.z,
        );
        const bodyYawError = shortestAngleDelta(alienBodyYaw, desiredBodyYaw);
        const playerPausedMs = performance.now() - lastPlayerMoveAt;
        const shouldIdleRecenter =
          playerPausedMs >= alienBodyRecenterPauseMs && Math.abs(bodyYawError) > alienBodyRecenterThreshold;
        const shouldBodyFollow = Math.abs(bodyYawError) > maxAlienHeadTrackYaw || shouldIdleRecenter;

        if (shouldBodyFollow) {
          let turnSpeed = shouldIdleRecenter ? alienBodyIdleRecenterSpeed : alienBodyFollowTurnSpeed;

          if (shouldIdleRecenter) {
            const rampUpRaw = THREE.MathUtils.clamp((playerPausedMs - alienBodyRecenterPauseMs) / 700, 0, 1);
            const rampUp = rampUpRaw * rampUpRaw * (3 - 2 * rampUpRaw);

            const errorMagnitude = Math.abs(bodyYawError);
            const rampDownRaw = THREE.MathUtils.clamp(errorMagnitude / THREE.MathUtils.degToRad(34), 0, 1);
            const rampDown = rampDownRaw * rampDownRaw * (3 - 2 * rampDownRaw);

            const easedTurnFactor = Math.max(0.18, rampUp * rampDown);
            turnSpeed = THREE.MathUtils.lerp(0.35, alienBodyIdleRecenterSpeed, easedTurnFactor);
          }

          const maxStep = turnSpeed * delta;
          alienBodyYaw = normalizeAngleRadians(alienBodyYaw + clamp(bodyYawError, -maxStep, maxStep));
          alienRoot.rotation.y = alienBodyYaw;
        }

        const headTrackYaw = -clamp(
          shortestAngleDelta(alienBodyYaw, desiredBodyYaw),
          -maxAlienHeadTrackYaw,
          maxAlienHeadTrackYaw,
        );
        for (const uniform of alienHeadTrackYawUniforms) {
          uniform.value = headTrackYaw;
        }

        const isHeadReactionActive = isHeadNoReactionActive || isHeadYesReactionActive;

        for (const uniform of alienArmTalkUniforms) {
          uniform.value = armTalkLevel;
        }

        for (const uniform of alienHeadTalkUniforms) {
          uniform.value = isHeadReactionActive ? 0 : armTalkLevel;
        }

        const headNoAngle =
          isHeadNoReactionActive
            ? headJoltDirectionRef.current * Math.sin(headReactionProgress * Math.PI * 4.2) * 0.34 * headReactionEnvelope
            : 0;
        const headYesAngle =
          isHeadYesReactionActive
            ? Math.pow(Math.sin(headReactionProgress * Math.PI * 2.0), 2) * 0.5 * headReactionEnvelope
            : 0;

        for (const uniform of alienHeadNoUniforms) {
          uniform.value = headNoAngle;
        }

        for (const uniform of alienHeadYesUniforms) {
          uniform.value = headYesAngle;
        }
      }

      for (const symbol of floatingWallSymbols) {
        const floatPhase = elapsed * symbol.driftSpeed + symbol.phase;
        const angleDrift = Math.sin(floatPhase * 0.65) * 0.04;
        const radialDrift = Math.sin(floatPhase * 0.52 + symbol.phase * 0.6) * symbol.radialDriftAmplitude;
        const animatedRadial = symbol.radial + radialDrift;
        const pulse = 0.2 + (Math.sin(elapsed * symbol.twinkleSpeed + symbol.phase) * 0.5 + 0.5) * 0.42;
        const shakeX =
          Math.sin(elapsed * (25 + symbol.twinkleSpeed * 2.8) + symbol.phase * 1.3) * wallSymbolFadeInShakeAmount;
        const shakeY =
          Math.cos(elapsed * (31 + symbol.driftSpeed * 3.2) + symbol.phase * 1.9) * wallSymbolFadeInShakeAmount * 0.52;
        const shakeZ =
          Math.sin(elapsed * (28 + symbol.twinkleSpeed * 2.1) + symbol.phase * 1.7) * wallSymbolFadeInShakeAmount;
        symbol.sprite.position.x = Math.cos(symbol.angle + angleDrift) * animatedRadial + shakeX;
        symbol.sprite.position.z = Math.sin(symbol.angle + angleDrift) * animatedRadial + shakeZ;
        symbol.sprite.position.y = symbol.baseY + Math.sin(floatPhase) * 0.14 + shakeY;

        const symbolMaterial = symbol.sprite.material as THREE.SpriteMaterial;
        symbolMaterial.opacity = pulse * wallSymbolVisibility;
      }

      renderer.render(scene, camera);
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      mountEl.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      mountEl.removeEventListener("touchstart", onTouchStart);
      mountEl.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      mountEl.classList.remove("is-dragging");

      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        const material = mesh.material;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else if (material) {
          material.dispose();
        }
      });

      renderer.dispose();
      for (const texture of floatingWallSymbolTextures) {
        texture.dispose();
      }
      if (renderer.domElement.parentElement === mountEl) {
        mountEl.removeChild(renderer.domElement);
      }
    };
  }, [
    clearTrackPauseTimeout,
    fadeBuildupTo,
    fadeFallingShipTo,
    isDevBuild,
    playDistantExplosionOneShot,
    playEndingRumbleOneShot,
    playFlickerZapOneShot,
    playFootstepOneShot,
    playShakingShipCue,
    stopShipHum,
    speechSupported,
  ]);

  const handleBeginQuestions = () => {
    phaseRef.current = "questions";
    setPhase("questions");
    setRevealProgress(0);
    setIsRevealing(true);
    revealProgressRef.current = 0;
    isRevealingRef.current = true;

    const revealAudio = revealAudioRef.current;
    if (revealAudio) {
      try {
        revealAudio.pause();
        revealAudio.currentTime = 0;
        revealAudio.muted = false;
        revealAudio.volume = 0;

        const playAttempt = revealAudio.play();
        if (playAttempt && typeof playAttempt.then === "function") {
          void playAttempt
            .then(() => {
              revealAudioStartedRef.current = true;
            })
            .catch(() => {
              revealAudioStartedRef.current = false;
            });
        } else {
          revealAudioStartedRef.current = true;
        }
      } catch {
        revealAudioStartedRef.current = false;
      }
    }

    ensureDarkHorrorAmbientPlaying();

    void startShipHum().catch(() => {
      // Never block start flow on audio context failures.
    });
  };

  const handlePick = (choice: ChoiceInternal, optionNumber: number) => {
    if (!currentTurn || phase !== "questions") return;

    stopQuestionSpeech();

    if (choice.delta !== 0) {
      triggerAlienHeadReaction(choice.delta);
    }

    const scoreBefore = score;
    const scoreAfter = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score + choice.delta));
    const nextTurnIndex = turnIndex + 1;

    setScore(scoreAfter);
    setHistory((prev) => [
      ...prev,
      {
        turnId: turnIndex + 1,
        chosenOptionNumber: optionNumber,
        questionText: currentTurn.alienLine,
        chosenAnswerText: choice.text,
        outcome: choice.outcome,
        delta: choice.delta,
        scoreBefore,
        scoreAfter,
      },
    ]);

    if (nextTurnIndex >= QUESTION_CONTENT.length) {
      endingSavedOutcomeRef.current = scoreAfter >= EARTH_SAVED_THRESHOLD;
      setPhase("ending");
    } else {
      setTurnIndex(nextTurnIndex);
    }
  };

  const handleSkipQuestion = () => {
    if (phase !== "questions") return;

    stopQuestionSpeech();
    const nextTurnIndex = turnIndex + 1;

    if (nextTurnIndex >= QUESTION_CONTENT.length) {
      endingSavedOutcomeRef.current = score >= EARTH_SAVED_THRESHOLD;
      setPhase("ending");
      return;
    }

    setTurnIndex(nextTurnIndex);
  };

  const handleRestart = () => {
    stopQuestionSpeech();
    clearPreparedSpeechCache();
    void stopShipHum();
    if (endingEchoTimeoutRef.current !== null) {
      window.clearTimeout(endingEchoTimeoutRef.current);
      endingEchoTimeoutRef.current = null;
    }
    endingEchoPlayedRef.current = false;
    if (speechSupported) {
      window.speechSynthesis.cancel();
    }
    setScore(0);
    setTurnIndex(0);
    setHistory([]);
    setEndingExplanation("");
    setRevealProgress(0);
    setIsRevealing(false);
    setEndingBlackoutOpacity(0);
    setEndingFlashOpacity(0);
    setEndingPanelVisible(false);
    revealProgressRef.current = 0;
    isRevealingRef.current = false;
    endingBlackoutOpacityRef.current = 0;
    endingFlashOpacityRef.current = 0;
    endingPanelVisibleRef.current = false;
    endingCinematicRef.current = {
      stage: "inactive",
      stageStartedAt: 0,
      blastStartedAt: 0,
      lastRumbleAt: 0,
    };
    phaseRef.current = "intro";
    setPhase("intro");
  };

  const saved = score >= EARTH_SAVED_THRESHOLD;
  const verdictLine = saved
    ? "The alien lowers its gaze and the ship begins to fade, its final words echoing softly—\"Earth may continue\""
    : "The alien’s many voices merge into one cold verdict—‘Earth has failed the protocol’—as a bright explosion swallows the sky.";
  const revealBlackoutOpacity = phase === "intro" ? 0 : isRevealing ? Math.max(0, 1 - revealProgress) : 0;
  const sceneBlackoutOpacity = Math.max(revealBlackoutOpacity, endingBlackoutOpacity);

  return (
    <main className="game-shell" onClickCapture={handleGlobalButtonClick}>
      <div ref={mountRef} className="scene-mount" aria-label="3D alien spaceship scene" />
      <div
        className="scene-blackout"
        style={{ opacity: sceneBlackoutOpacity }}
        aria-hidden="true"
      />
      <div className="scene-flashout" style={{ opacity: endingFlashOpacity }} aria-hidden="true" />
      <div className="scene-vignette" aria-hidden="true" />

      <aside className="game-hud">
        <div className="control-dock">
          <div className={`control-group ${isHelpOpen ? "is-open" : ""}`}>
            <button
              className="control-icon-btn"
              type="button"
              onClick={() => setIsHelpOpen((open) => !open)}
              aria-label="Toggle controls help"
              aria-expanded={isHelpOpen}
            >
              <svg className="control-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M8.9 9.1A3.3 3.3 0 0 1 12 6.8c1.9 0 3.3 1.2 3.3 2.9 0 1.5-0.8 2.3-2.1 3.1-1.1 0.6-1.7 1.1-1.7 2.2v0.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="12" cy="18.1" r="1" fill="currentColor" />
              </svg>
            </button>
            <div className="control-panel help-panel" aria-hidden={!isHelpOpen}>
              <span className="desktop-only-hint">WASD to walk</span>
              <span>Drag screen to look</span>
            </div>
          </div>

          <div className={`control-group ${isVolumeOpen ? "is-open" : ""}`}>
            <button
              className="control-icon-btn"
              type="button"
              onClick={() => setIsVolumeOpen((open) => !open)}
              aria-label="Toggle volume control"
              aria-expanded={isVolumeOpen}
            >
              <svg className="control-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 9h4l5-4v14l-5-4H4z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d="M16 9.5c1.4 1.2 1.4 3.8 0 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M18.8 7.2c2.5 2.3 2.5 7.3 0 9.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div className="control-panel volume-panel" aria-hidden={!isVolumeOpen}>
              <input
                id="master-volume"
                className="volume-slider"
                type="range"
                min={0}
                max={100}
                value={masterVolume}
                onChange={(event) => {
                  setMasterVolume(Number(event.target.value));
                }}
              />
              <span className="volume-value">{masterVolume}%</span>
            </div>
          </div>
        </div>

        {phase === "intro" && (
          <div className="qa-panel qa-intro-panel">
            <div className="qa-title">Protocol 0</div>
            <p className="qa-text">
              Greetings. You have been selected to play this game. It will determine your fate and the Earth's fate. There
              will be a sequence of questions you must answer to safely return back to Earth. If you choose to disobey,
              your life will no longer exist.
            </p>
            <button className="qa-btn" onClick={handleBeginQuestions}>
              Begin Questions
            </button>
          </div>
        )}

        {phase === "questions" && currentTurn && (
          <div
            className="qa-panel qa-question-panel"
            style={{
              opacity: isRevealing ? revealProgress : 1,
              transform: `translate(-50%, ${(1 - (isRevealing ? revealProgress : 1)) * 6}px)`,
              pointerEvents: isRevealing ? "none" : "auto",
            }}
          >
            <div className="qa-title">ALIEN:</div>
            <p className="qa-text qa-question-text" aria-live="polite">
              {typedAlienText}
            </p>
            {isDevBuild && (
              <button className="qa-btn" onClick={handleSkipQuestion} style={{ marginTop: "0.45rem" }}>
                DEV: Skip Question
              </button>
            )}
            <div className={`qa-answer-block${answersVisible ? " is-visible" : ""}`}>
              <div className="qa-title">ANSWER:</div>
              <div className="qa-choices">
                {displayChoices.map((choice, index) => (
                  <button
                    key={index}
                    className="qa-btn"
                    onClick={() => handlePick(choice, index + 1)}
                    disabled={!answersVisible}
                  >
                    {choice.text}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {phase === "ending" && endingPanelVisible && (
          <div className="qa-panel">
            <div className="ending-verdict-inline">
              <div className="qa-title">Final Verdict</div>
              <p className="qa-text">{verdictLine}</p>
            </div>

            <div className="qa-title qa-subtitle">Explanation</div>
            <p className="qa-text qa-analysis">
              Communication Score: {score}. Your Protocol Score measures how well your choices show humanity’s ability
              to communicate and coexist beyond human-centered thinking: points are added when answers show openness,
              empathy, adaptation, and respect for non-human intelligence (animals, ecosystems, AI, alien systems), and
              points are removed when answers reflect human bias—like assuming humans are the center, forcing unknown
              signals into human definitions, or treating other forms of life and intelligence only as tools. The score
              ranges from -10 to +10, and the alien uses it to judge whether humanity is capable of changing its
              perspective: if your final score is 2 or higher, Earth is spared; if it is below 2, Earth is destroyed.
            </p>

            <div className="qa-title qa-subtitle">
              {endingExplanation ? "Generated Analysis:" : "Generating Analysis of your choices."}
            </div>
            <p className="qa-text qa-analysis">
              {!endingExplanation ? "Generating..." : endingExplanation || fallbackOutcomeExplanation(saved, score, history)}
            </p>
            <button className="qa-btn" onClick={handleRestart}>
              Restart Questions
            </button>
          </div>
        )}
      </aside>
    </main>
  );
}