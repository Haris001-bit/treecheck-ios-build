export function withinTrial(end: string | null | undefined, now = Date.now()): boolean {
  return !!end && Number.isFinite(Date.parse(end)) && Date.parse(end) > now;
}

export function brandVoice(v: Record<string, unknown>): string {
  const list = (key: string, other: string) => [...(Array.isArray(v[key]) ? v[key] : []), v[other]].filter(Boolean).join(', ');
  return [
    `Tone: ${list('tone', 'toneOther') || 'Calm, clear and practical'}.`,
    `Customer concerns: ${list('concerns', 'concernsOther') || 'Do not assume customer concerns'}.`,
    `Desired positioning (not verified claims): ${list('standards', 'standardsOther') || 'Use only job details'}.`,
    v.story && `Company story supplied by owner: ${v.story}`,
    v.favoritePhrases && `Preferred phrases: ${v.favoritePhrases}`,
    v.avoid && `Avoid: ${v.avoid}`,
    v.example && `Owner's voice example: ${v.example}`,
    'Never invent insurance, credentials, years in business, pricing, availability or promises. No scare tactics or fake urgency. Positioning is not proof. Job facts override style guidance.',
  ].filter(Boolean).join('\n');
}

export function connectedPublisher(owner: string, integration: { site_provider?: string; publish_endpoint_url?: string; website_url?: string } | null): boolean {
  // Match the existing publisher's explicit tenant routing; an arbitrary URL is not a connection.
  if (['cf93d0f4-9365-4352-b0cb-10ce93646843', '705cecc2-5926-48c1-a728-b3ebd6b920a2', '914561d0-fba3-4b90-97b7-673ed8e8b458'].includes(owner)) return true;
  const secretTenants = ['cae6f999-5dec-4498-8ac4-577485b7fbc5', '5972f13f-7c5b-465d-9cc1-faef4cdbd4df'];
  return secretTenants.includes(owner) && integration?.site_provider === 'first_impression' && /^https:\/\//.test(integration.publish_endpoint_url || integration.website_url || '');
}