import { z } from 'zod';

export const VOICE_OPTIONS = {
  tone: ['Friendly & neighborly', 'Calm & professional', 'Direct & no-nonsense', 'Educational', 'Thankful & family-oriented', 'Premium & polished'],
  concerns: ['Property damage', 'Safety', 'Fair pricing', 'No-shows & poor communication', 'Mess left behind', 'Pressure or unnecessary work'],
  standards: ['Careful work', 'Clear estimates', 'Reliable communication', 'Thorough cleanup', 'Honest recommendations', 'Difficult jobs'],
} as const;
const short = z.string().trim().max(1000);
export const voiceSchema = z.object({
  tone: z.array(z.string().max(100)).max(3), toneOther: short,
  concerns: z.array(z.string().max(100)).max(3), concernsOther: short,
  standards: z.array(z.string().max(100)).max(3), standardsOther: short,
  story: short, favoritePhrases: short, avoid: short, example: short,
});
export const dmaSetupSchema = z.object({
  company_name: z.string().trim().min(1, 'Enter your company name.').max(150),
  contact_name: z.string().trim().min(1, 'Enter your contact name.').max(100),
  delivery_email: z.string().trim().email('Enter a valid delivery email.').max(255),
  service_area: z.string().trim().min(1, 'Enter your service area.').max(200),
  website_url: z.union([z.literal(''), z.string().trim().url().max(500).refine(v => /^https?:\/\//i.test(v), 'Use an http or https website address.')]),
  voice_answers: voiceSchema,
  voice_preview: z.string().trim().max(2000),
});
export type VoiceAnswers = z.infer<typeof voiceSchema>;
export type DMASetupValues = z.infer<typeof dmaSetupSchema>;
export const EMPTY_VOICE: VoiceAnswers = { tone: [], toneOther: '', concerns: [], concernsOther: '', standards: [], standardsOther: '', story: '', favoritePhrases: '', avoid: '', example: '' };

export function buildBrandVoice(v: VoiceAnswers): string {
  return [
    `Tone: ${[...v.tone, v.toneOther].filter(Boolean).join(', ') || 'Calm, clear and practical'}.`,
    `Customer concerns: ${[...v.concerns, v.concernsOther].filter(Boolean).join(', ') || 'Do not assume customer concerns'}.`,
    `Desired positioning (not verified claims): ${[...v.standards, v.standardsOther].filter(Boolean).join(', ') || 'Use only job details'}.`,
    v.story && `Company story supplied by owner: ${v.story}`,
    v.favoritePhrases && `Preferred phrases: ${v.favoritePhrases}`,
    v.avoid && `Avoid: ${v.avoid}`,
    v.example && `Owner's voice example: ${v.example}`,
    'Never invent insurance, credentials, years in business, pricing, availability or promises. No scare tactics or fake urgency. Positioning is not proof. Job facts override style guidance.',
  ].filter(Boolean).join('\n');
}

export function voiceSample(v: VoiceAnswers): string {
  if (v.example.trim()) return v.example.trim();
  if (v.tone.includes('Direct & no-nonsense')) return "Every tree job is different. Here’s what we’re seeing, what the work involves, and the options to consider.";
  if (v.tone.includes('Thankful & family-oriented')) return "Thank you for taking a look at our work. Here’s a closer look at this tree job and what went into it.";
  if (v.tone.includes('Educational')) return "A good tree-work decision starts with understanding the job. Here’s a look at the work involved and the options to consider.";
  return "Here’s a closer look at this tree job. Every property is different, and the details help explain the work involved.";
}

export function withinDMATrial(end: string | null | undefined, now = Date.now()): boolean {
  return !!end && Number.isFinite(Date.parse(end)) && Date.parse(end) > now;
}