export type Modifiers = { shiftKey: boolean; altKey: boolean };
let modifiers: Modifiers = { shiftKey: false, altKey: false };
const modifierListeners = new Set<(held: Modifiers) => void>();

export function setModifiers(held: Readonly<Modifiers>) {
  if (modifiers.shiftKey === held.shiftKey && modifiers.altKey === held.altKey) {
    return;
  }
  modifiers = { shiftKey: held.shiftKey, altKey: held.altKey };
  for (const listener of modifierListeners) {
    listener(modifiers);
  }
}

export function getModifiers(): Modifiers {
  return modifiers;
}

export function onModifiers(listener: (held: Modifiers) => void) {
  modifierListeners.add(listener);
  return () => {
    modifierListeners.delete(listener);
  };
}
