export type MenuDescription = {
  description: string;
  descriptionNote?: string;
  descriptionSources?: { title: string; url: string }[];
};
export function getMenuDescription(category: string, name: string): MenuDescription | undefined;
export function withMenuDescription<T extends { name: string; category: string; description?: string; descriptionNote?: string; descriptionSources?: { title: string; url: string }[] }>(item: T, store: string): T & MenuDescription;
