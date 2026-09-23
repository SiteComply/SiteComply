import { prisma } from '@/lib/prisma';
import { resolveAiProvider } from '@/services/ai/aiConfigService';
import { loadBriefingSource } from '@/services/induction/inductionBriefingService';
import { getSiteRules } from '@/services/checklists/siteRulesService';
import { getSitePpeRequirements } from '@/services/checklists/sitePpeService';
import {
  buildSceneManifest,
  manifestHash,
  type SceneManifest,
  type SceneRequirement,
  type VideoSource,
} from '@/services/inductionVideo/sceneRules';

/**
 * Turning a verified scene manifest into narration.
 *
 * THE MODEL WRITES, IT DOES NOT DECIDE. It receives the scenes the rules engine
 * chose and the facts behind each one, and returns one piece of narration per
 * scene. It is given no other site data, so there is nothing else for it to
 * mention: a hazard, a telephone number or a precaution it was not handed
 * cannot appear in the output.
 *
 * WHAT COMES BACK IS CHECKED, NOT TRUSTED. Scenes that were not asked for are
 * dropped, missing ones fall back to the facts themselves, and narration is
 * length-capped. The same discipline the knowledge-check bank applies to its
 * questions: a model's output is a proposal.
 */

export const PROMPT_VERSION = 'induction-video-v1';

/** Roughly 150 words a scene, which narrates in about a minute. */
const MAX_NARRATION_CHARS = 900;

const SYSTEM_PROMPT = [
  'You write site induction narration for UK construction sites, in British English.',
  'You will be given the scenes of one induction and the verified facts for each scene.',
  'Write narration for each scene, spoken aloud to an operative arriving on site.',
  'RULES, all absolute:',
  '- Use ONLY the facts given for that scene. Never add a hazard, precaution, location, name, telephone number, procedure or statistic that is not in the facts.',
  '- Never soften or qualify a safety instruction, and never invent a reassurance.',
  '- Do not invent durations, distances, times or quantities.',
  '- Plain, calm, direct language. Short sentences. Second person ("you").',
  '- No greetings beyond the welcome scene, no sign-off beyond the closing scene.',
  '- British spelling. Say "personal protective equipment" before using "PPE".',
  '- If the facts for a scene are thin, say less. Do not pad.',
  `- Keep each scene under ${MAX_NARRATION_CHARS} characters.`,
].join('\n');

const SCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes'],
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sceneType', 'narration'],
        properties: {
          sceneType: { type: 'string' },
          narration: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface GeneratedScript {
  scenes: {
    sceneType: string;
    heading: string;
    narration: string;
    required: boolean;
    sourceRefs: string[];
    visualTemplate: string;
  }[];
  provider: string;
  model: string;
  promptVersion: string;
  sourceHash: string;
  tokensPrompt?: number;
  tokensOutput?: number;
}

/** Everything the rules engine needs, loaded from the site's own records. */
export async function loadVideoSource(siteId: string): Promise<VideoSource | null> {
  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true, name: true },
  });
  if (!site) return null;

  const [briefing, rules, ppe] = await Promise.all([
    // The SAME source the induction briefing screens are built from - see
    // loadBriefingSource. One loader, so the video cannot narrate something the
    // induction does not show.
    loadBriefingSource(site.id, site.name, null),
    getSiteRules(site.id),
    getSitePpeRequirements(site.id),
  ]);
  if (!briefing) return null;

  return {
    ...briefing,
    siteRules: rules.map((r) => r.label.trim()).filter(Boolean),
    ppe: ppe.map((p) => p.label.trim()).filter(Boolean),
  };
}

export async function manifestForSite(siteId: string): Promise<SceneManifest | null> {
  const src = await loadVideoSource(siteId);
  return src ? buildSceneManifest(src) : null;
}

/**
 * Narration for a manifest.
 *
 * The manifest is the contract: whatever the model returns, the scenes and their
 * order are the rules engine's. A scene the model skipped keeps its facts as
 * narration, which is plainer than intended but never wrong.
 */
export async function generateScript(
  manifest: SceneManifest,
  siteName: string,
): Promise<GeneratedScript> {
  if (!manifest.canGenerate) {
    throw new Error('The scene manifest is blocked; generation must not be attempted.');
  }

  const provider = await resolveAiProvider();
  const user = JSON.stringify({
    site: siteName,
    scenes: manifest.scenes.map((s) => ({
      sceneType: s.sceneType,
      heading: s.heading,
      facts: s.facts,
    })),
  });

  const result = await provider.complete({
    system: SYSTEM_PROMPT,
    user,
    schema: SCRIPT_SCHEMA as unknown as Record<string, unknown>,
    /*
     * GENEROUS, because a reasoning model spends a large and variable share of
     * this budget on hidden reasoning BEFORE any narration appears. An
     * induction runs to a dozen scenes of 100-150 words; 2,000 would have been
     * spent thinking, and every scene would have quietly fallen back to its
     * bare facts - working, but flat, and for a reason nobody could see.
     */
    maxOutputTokens: 8000,
    /*
     * NO TEMPERATURE. The production deployment is a reasoning model, which
     * rejects any value but the default with a 400 - the same constraint the
     * knowledge-check bank documents. The provider only forwards a temperature
     * when a caller sets one, so setting none is what works on both.
     *
     * It costs nothing here: the facts are fixed by the manifest, and a scene
     * the model declines to phrase falls back to those facts.
     */
  });

  const returned = parseScenes(result.json ?? safeParse(result.text));

  return {
    scenes: manifest.scenes.map((scene) => ({
      sceneType: scene.sceneType,
      heading: scene.heading,
      narration: narrationFor(scene, returned.get(scene.sceneType)),
      required: scene.required,
      sourceRefs: scene.sourceRefs,
      visualTemplate: scene.visualTemplate,
    })),
    provider: provider.name,
    model: result.model,
    promptVersion: PROMPT_VERSION,
    sourceHash: manifestHash(manifest),
    tokensPrompt: result.tokensPrompt,
    tokensOutput: result.tokensOutput,
  };
}

/**
 * The narration for one scene: the model's, cleaned, or the facts themselves.
 *
 * FALLING BACK TO THE FACTS is deliberate. A scene the rules engine required
 * must appear, and an induction that reads like a list is better than one that
 * silently drops the asbestos scene because a model returned nothing for it.
 */
function narrationFor(scene: SceneRequirement, candidate: string | undefined): string {
  const text = (candidate ?? '').trim().replace(/\s+/g, ' ');
  /*
   * The fallback must still be READABLE. Several scenes carry a list - permit
   * types, site rules, PPE - and joining those raw produced "Hot Works
   * Electrical Isolation Working at Height", which is not a sentence and would
   * be narrated as one breathless run. Each fact is closed off instead.
   */
  if (!text) {
    return scene.facts
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => (/[.!?]$/.test(f) ? f : `${f}.`))
      .join(' ');
  }
  return text.length > MAX_NARRATION_CHARS
    ? `${text.slice(0, MAX_NARRATION_CHARS).trimEnd()}…`
    : text;
}

function parseScenes(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const scenes = (json as { scenes?: unknown })?.scenes;
  if (!Array.isArray(scenes)) return out;
  for (const raw of scenes) {
    if (!raw || typeof raw !== 'object') continue;
    const sceneType = (raw as { sceneType?: unknown }).sceneType;
    const narration = (raw as { narration?: unknown }).narration;
    if (typeof sceneType !== 'string' || typeof narration !== 'string') continue;
    // Last one wins; a model repeating a scene is not a reason to fail.
    out.set(sceneType, narration);
  }
  return out;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
