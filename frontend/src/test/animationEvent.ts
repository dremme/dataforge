// jsdom has no AnimationEvent, and react-dom picks its animation event names when it loads:
// without one it listens for `webkitAnimationEnd`, which `fireEvent.animationEnd` never sends.
// Import this before anything that loads react-dom.
class AnimationEventPolyfill extends Event {
  readonly animationName: string;
  readonly elapsedTime: number;
  readonly pseudoElement: string;

  constructor(type: string, init: AnimationEventInit = {}) {
    super(type, init);
    this.animationName = init.animationName ?? "";
    this.elapsedTime = init.elapsedTime ?? 0;
    this.pseudoElement = init.pseudoElement ?? "";
  }
}

if (!("AnimationEvent" in window)) {
  Object.defineProperty(window, "AnimationEvent", {
    value: AnimationEventPolyfill,
    writable: true,
    configurable: true,
  });
}
