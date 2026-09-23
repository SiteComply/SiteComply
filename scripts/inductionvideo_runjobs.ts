export {};
/** Drain queued script jobs with a stubbed model, for the browser walk. */
const stubPath = require.resolve('../services/ai/aiConfigService');
const realCfg = require(stubPath);
require.cache[stubPath] = { id: stubPath, filename: stubPath, loaded: true,
  exports: { ...realCfg, resolveAiProvider: async () => ({
    name: 'stub',
    complete: async (input: any) => ({
      text: '', model: 'stub-1', tokensPrompt: 900, tokensOutput: 300,
      json: { scenes: JSON.parse(input.user).scenes.map((s: any) => ({
        sceneType: s.sceneType,
        narration: `${s.facts.join(' ')} Please follow this on site.`,
      })) },
    }),
  }) } } as never;
const svc = require('../services/inductionVideo/inductionVideoService');
svc.runQueuedScriptJobs().then((n: number) => { console.log(`ran ${n}`); process.exit(0); });
