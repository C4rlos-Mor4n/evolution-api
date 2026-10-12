// `groups.update` normalizes to GROUPS_UPDATE, but subscriptions and env config historically use GROUP_UPDATE,
// so the event was never delivered (upstream #2652). Both names are accepted to keep existing configs working.
const EVENT_ALIASES: Record<string, string[]> = {
  GROUPS_UPDATE: ['GROUPS_UPDATE', 'GROUP_UPDATE'],
  GROUP_UPDATE: ['GROUP_UPDATE', 'GROUPS_UPDATE'],
};

export const eventKeys = (eventKey: string): string[] => EVENT_ALIASES[eventKey] ?? [eventKey];

export const isEventInList = (list: unknown, eventKey: string): boolean =>
  Array.isArray(list) && eventKeys(eventKey).some((key) => list.includes(key));

export const isEventEnabled = (events: Record<string, unknown> | undefined, eventKey: string): boolean =>
  !!events && eventKeys(eventKey).some((key) => !!events[key]);
