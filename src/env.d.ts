declare const __PWA__: boolean;

// The artifact viewer's capability bridge (absent everywhere else).
interface Window {
  claude?: { use(name: string): Promise<unknown> };
}
