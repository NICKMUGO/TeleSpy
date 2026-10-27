/**
 * The macOS "genie" minimise, for dialogs. The edge nearest the target is
 * pulled toward it first, bending the panel into a curved funnel; then the
 * far edge follows and the whole panel flows into the point. Opening plays
 * it in reverse, pouring out of the point.
 *
 * CSS can't warp an element, so the funnel is a clip-path whose sides follow
 * an S-curve, while a translate + scaleY carries what's left into the target.
 * Keyframes are built per open because they depend on where the target is.
 */

const FRAMES = 30;
/** Points down each curved side of the funnel. */
const POINTS = 16;
/** A target this far (px) to one side leans the neck all the way over. */
const FULL_LEAN_AT = 400;

let counter = 0;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const n = (x: number) => Number(x.toFixed(2));

/** The panel at progress t (0 = whole, 1 = gone into the target), with the
 * target dx/dy px from the panel's centre. */
function frame(t: number, dx: number, dy: number) {
  const down = dy >= 0;
  // Phase one pinches the near edge; phase two (overlapping) travels.
  const pinch = smooth(clamp01(t / 0.45));
  const travel = smooth(clamp01((t - 0.25) / 0.75));

  // Half-widths, in % of the panel, at the near and far edges.
  const near = lerp(lerp(50, 6, pinch), 3, travel);
  const far = lerp(lerp(50, 44, pinch), 3, travel);
  // The neck leans toward the target (in % of the panel), never so far
  // that a curved side runs off the panel's own box and gets cut flat.
  const lean =
    Math.sign(dx) *
    Math.min(1, Math.abs(dx) / FULL_LEAN_AT) *
    (50 - near) *
    pinch *
    (1 - travel);

  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < POINTS; i++) {
    const s = i / (POINTS - 1); // 0 at the far edge, 1 at the near edge
    const k = smooth(s);
    const half = lerp(far, near, k);
    const shift = lean * k;
    const y = n(down ? s * 100 : (1 - s) * 100);
    left.push(`${n(50 - half + shift)}% ${y}%`);
    right.push(`${n(50 + half + shift)}% ${y}%`);
  }
  const outline = [...left, ...right.reverse()].join(",");

  // Squash toward the near edge while it travels, landing that edge on the
  // target: the far edge arrives last.
  const towards = down ? "-" : "+";
  const ty = `calc(${n(dy * travel)}px ${towards} ${n(50 * travel)}%)`;
  const scaleY = n(lerp(1, 0.03, travel));
  const opacity = t > 0.85 ? n(1 - (t - 0.85) / 0.15) : 1;

  return (
    `clip-path:polygon(${outline});` +
    `transform-origin:50% ${down ? "100%" : "0%"};` +
    `transform:translate(${n(dx * travel)}px,${ty}) scaleY(${scaleY});` +
    `opacity:${opacity};`
  );
}

function keyframes(name: string, dx: number, dy: number, opening: boolean) {
  let css = `@keyframes ${name}{`;
  for (let i = 0; i <= FRAMES; i++) {
    const t = i / FRAMES;
    css += `${n(t * 100)}%{${frame(opening ? 1 - t : t, dx, dy)}}`;
  }
  return css + "}";
}

/** The centre of the control the pointer last went down on, so a dialog
 * genies out of (and back into) the button that opened it. Taken at press
 * time, since a menu item that opens a dialog is gone by the time it's up. */
let lastPress: { x: number; y: number; at: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      const control =
        e.target instanceof Element
          ? e.target.closest("button, a, [role=button], [role=menuitem]")
          : null;
      const box = control?.getBoundingClientRect();
      lastPress = box
        ? {
            x: box.left + box.width / 2,
            y: box.top + box.height / 2,
            at: Date.now(),
          }
        : { x: e.clientX, y: e.clientY, at: Date.now() };
    },
    { capture: true, passive: true },
  );
}

/** Where the dialog opening right now came from: the button just pressed,
 * else the focused one (opened from the keyboard), else the bottom of the
 * screen, like the Dock. */
function origin(w: number, h: number) {
  if (lastPress && Date.now() - lastPress.at < 1500) return lastPress;
  const focused = document.activeElement;
  if (focused && focused !== document.body) {
    const box = focused.getBoundingClientRect();
    if (box.width || box.height)
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }
  return { x: w / 2, y: h };
}

export interface Genie {
  /** The @keyframes to insert while the panel is mounted. */
  css: string;
  /** Sets --genie-in / --genie-out to the animations that use them. */
  style: Record<string, string>;
}

/** A genie into/out of whatever opened the panel, for a panel centred on
 * screen. Call it as the panel opens, before focus moves into it. */
export function makeGenie(): Genie {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const press = origin(w, h);
  const dx = press.x - w / 2;
  const dy = press.y - h / 2;
  const id = `genie-${++counter}`;
  return {
    css:
      keyframes(`${id}-in`, dx, dy, true) +
      keyframes(`${id}-out`, dx, dy, false),
    style: {
      "--genie-in": `${id}-in 0.55s cubic-bezier(0.2, 0.7, 0.3, 1) backwards`,
      "--genie-out": `${id}-out 0.5s cubic-bezier(0.5, 0, 0.7, 0.4) forwards`,
    },
  };
}
