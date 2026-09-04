// Custom local ESLint rule: raw color literals (hex, rgb()/rgba(), hsl()/hsla())
// may only live in app/globals.css under @theme. Everywhere else, components must
// reference semantic Tailwind classes (bg-primary, text-foreground, etc.) so the
// design system stays single-sourced.
const HEX_PATTERN = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/;
const FUNCTIONAL_COLOR_PATTERN = /\b(?:rgba?|hsla?|oklch)\(/i;

function checkValue(context, node, value) {
  if (typeof value !== "string") return;
  if (HEX_PATTERN.test(value) || FUNCTIONAL_COLOR_PATTERN.test(value)) {
    context.report({ node, messageId: "noHexLiteral" });
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw color literals (hex/rgb/hsl/oklch) outside app/globals.css. Use semantic Tailwind classes instead.",
    },
    schema: [],
    messages: {
      noHexLiteral:
        "Raw color literal found. Colors may only be defined in app/globals.css under @theme — use a semantic class (bg-primary, text-foreground, border-destructive, etc.) here instead.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        checkValue(context, node, node.value);
      },
      TemplateElement(node) {
        checkValue(context, node, node.value.raw);
      },
      JSXAttribute(node) {
        if (
          node.value &&
          node.value.type === "Literal" &&
          typeof node.value.value === "string"
        ) {
          checkValue(context, node, node.value.value);
        }
      },
    };
  },
};

const plugin = {
  rules: {
    "no-hex-color-literals": rule,
  },
};

export default plugin;
