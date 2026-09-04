#!/usr/bin/env node
// WCAG 2.2 AA contrast gate for src/app/globals.css.
//
// Reads the design tokens directly out of globals.css (never duplicates
// color values elsewhere — that's the whole point of "one tokens file"),
// resolves each semantic token through its var() chain to a literal
// oklch(...) value, converts OKLCH -> linear sRGB -> relative luminance
// per the CSS Color 4 / WCAG formulas, and checks every text/background
// and UI-boundary pair the app actually renders against the 4.5:1 (body
// text) / 3:1 (large text, UI boundaries) thresholds.
//
// Plain Node ESM, zero extra dependencies — this is a dev-only script, and
// the OKLCH math is a small, stable, well-documented conversion (Björn
// Ottosson's reference OKLab matrices), not worth pulling in a color
// library for.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(dirname, "../src/app/globals.css");
const css = readFileSync(cssPath, "utf8");

function extractBlock(css, selectorSource) {
  const re = new RegExp(selectorSource + "\\s*\\{([\\s\\S]*?)\\n\\}", "m");
  const m = css.match(re);
  if (!m) throw new Error(`Could not find block: ${selectorSource}`);
  return m[1];
}

function parseDeclarations(blockText) {
  const vars = new Map();
  const re = /--([a-zA-Z0-9-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(blockText))) {
    vars.set(m[1], m[2].trim());
  }
  return vars;
}

const themeVars = parseDeclarations(extractBlock(css, "@theme"));
const rootVars = parseDeclarations(extractBlock(css, ":root"));
const darkVars = parseDeclarations(extractBlock(css, "\\.dark"));

const lightVars = new Map([...themeVars, ...rootVars]);
const darkAllVars = new Map([...themeVars, ...rootVars, ...darkVars]);

function resolve(value, vars, depth = 0) {
  if (depth > 10) throw new Error(`var() resolution too deep: ${value}`);
  const varMatch = value.match(/^var\(--([a-zA-Z0-9-]+)\)$/);
  if (varMatch) {
    const next = vars.get(varMatch[1]);
    if (!next) throw new Error(`Undefined var: --${varMatch[1]}`);
    return resolve(next, vars, depth + 1);
  }
  return value;
}

function parseOklch(value) {
  const m = value.match(
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%?\s*)?\)/,
  );
  if (!m) throw new Error(`Not an oklch() value: ${value}`);
  const alpha = m[4] === undefined ? 1 : Number(m[4]) / 100;
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]), alpha };
}

// OKLCH -> OKLab -> linear sRGB (D65).
// Reference: https://bottosson.github.io/posts/oklab/
function oklchToLinearSrgb({ l, c, h }) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

// WCAG relative luminance operates on linear-light channel values clamped to
// the sRGB gamut ([0, 1]) — matches how a browser clips an out-of-gamut
// oklch() color when painting it.
function relativeLuminance(linearRgb) {
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const r = clamp(linearRgb.r);
  const g = clamp(linearRgb.g);
  const b = clamp(linearRgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function blend(fgLinear, alpha, bgLinear) {
  return {
    r: alpha * fgLinear.r + (1 - alpha) * bgLinear.r,
    g: alpha * fgLinear.g + (1 - alpha) * bgLinear.g,
    b: alpha * fgLinear.b + (1 - alpha) * bgLinear.b,
  };
}

// `fg` may be semi-transparent (e.g. dark-mode borders are white-at-N%) — in
// that case the color actually painted is fg alpha-composited over `bg`, not
// fg's own oklch value, so blend before computing luminance.
function contrastRatio(fg, bg) {
  const bgLinear = oklchToLinearSrgb(bg);
  let fgLinear = oklchToLinearSrgb(fg);
  if (fg.alpha < 1) fgLinear = blend(fgLinear, fg.alpha, bgLinear);

  const lFg = relativeLuminance(fgLinear);
  const lBg = relativeLuminance(bgLinear);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenColor(name, vars) {
  const raw = vars.get(name);
  if (!raw) throw new Error(`Unknown token: --${name}`);
  return parseOklch(resolve(raw, vars));
}

// [foreground token, background token, minimum ratio, what it covers]
const PAIRS = [
  ["foreground", "background", 4.5, "body text"],
  ["card-foreground", "card", 4.5, "card body text"],
  ["popover-foreground", "popover", 4.5, "popover text"],
  ["primary-foreground", "primary", 4.5, "primary button label"],
  ["secondary-foreground", "secondary", 4.5, "secondary button label"],
  ["muted-foreground", "background", 4.5, "muted text on page background"],
  ["muted-foreground", "muted", 4.5, "muted text on muted background"],
  ["accent-foreground", "accent", 4.5, "accent text"],
  ["destructive-foreground", "destructive", 4.5, "destructive button label"],
  ["warning-foreground", "warning", 4.5, "warning chip text"],
  ["success-foreground", "success", 4.5, "success chip text"],
  ["info-foreground", "info", 4.5, "info chip text"],
  ["sidebar-foreground", "sidebar", 4.5, "sidebar text"],
  [
    "sidebar-primary-foreground",
    "sidebar-primary",
    4.5,
    "sidebar active item label",
  ],
  [
    "sidebar-accent-foreground",
    "sidebar-accent",
    4.5,
    "sidebar hover item label",
  ],
  ["border", "background", 3.0, "border vs page background (UI boundary)"],
  ["ring", "background", 3.0, "focus ring vs page background"],
  ["primary", "background", 3.0, "primary brand mark vs page background"],
  ["sidebar-border", "sidebar", 3.0, "sidebar border (UI boundary)"],
  ["sidebar-ring", "sidebar", 3.0, "sidebar focus ring"],
];

let hasFailure = false;

function runMode(modeLabel, vars) {
  console.log(`\n${modeLabel}`);
  console.log("-".repeat(modeLabel.length));
  for (const [fg, bg, min, description] of PAIRS) {
    const ratio = contrastRatio(tokenColor(fg, vars), tokenColor(bg, vars));
    const pass = ratio >= min;
    if (!pass) hasFailure = true;
    const status = pass ? "PASS" : "FAIL";
    console.log(
      `  [${status}] ${ratio.toFixed(2)}:1 (need ${min.toFixed(1)}:1)  ` +
        `--${fg} on --${bg}  (${description})`,
    );
  }
}

runMode("Light mode", lightVars);
runMode("Dark mode", darkAllVars);

console.log("");
if (hasFailure) {
  console.error("Contrast check FAILED — see FAIL rows above.");
  process.exit(1);
} else {
  console.log("All token pairs meet WCAG 2.2 AA.");
}
