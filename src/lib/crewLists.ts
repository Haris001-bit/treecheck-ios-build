export function matchesCrewTrade(trade: string, selected: string) {
  return selected === 'all' || trade === selected || (trade === 'both' && ['climber', 'ground'].includes(selected));
}
export function hasWorkedTogether(member: { id: string; worked_together_before?: boolean }, completedIds: ReadonlySet<string>) {
  return member.worked_together_before === true || completedIds.has(member.id);
}
export function isNewNetworkResult(userId: string, ownMembers: { user_id: string | null }[]) {
  return !ownMembers.some((member) => member.user_id === userId);
}
