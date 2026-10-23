import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Safari before 18 only knows backdrop-filter with its prefix, and before 15.4 has no dvh unit. The styles must still
// work there: a fallback beside each.

const css = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const declarations = (text: string) => text.split(/[;{}]/).map((d) => d.trim());

const SUPPORTS = '@supports (height: 100dvh)';
/** Sizes tied to the screen's height, which iOS makes taller than the page shows. Paddings and gaps that scale with it are not. */
const SIZES = /^(--|height$|max-height$|min-height$)/;

interface Rule {
  selector: string;
  /** The at-rules around it, outermost first: @media (...), @supports (...). */
  context: string[];
  decls: string[];
}

/** Every rule with its declarations and the at-rules it sits in, with comments dropped. */
function parse(text: string): Rule[] {
  const rules: Rule[] = [];
  const stack: string[] = [];
  let body = '';
  for (const ch of text.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') {
      // What came since the last brace or semicolon names the block that opens.
      const name = body.trim().replace(/\s+/g, ' ');
      stack.push(/^@supports\s*\(\s*height\s*:\s*100dvh\s*\)$/.test(name) ? SUPPORTS : name);
      body = '';
    } else if (ch === '}') {
      const name = stack.pop() ?? '';
      const decls = body.split(';').map((d) => d.trim()).filter(Boolean);
      if (!name.startsWith('@') && decls.length) rules.push({ selector: name, context: stack.filter((s) => s.startsWith('@')), decls });
      body = '';
    } else body += ch;
  }
  return rules;
}

const sameMedia = (a: Rule, b: Rule) => a.context.filter((c) => c !== SUPPORTS).join('|') === b.context.filter((c) => c !== SUPPORTS).join('|');

describe('styles for older Safari', () => {
  for (const file of ['ui/style.css', 'kit/kit.css']) {
    it(`${file}: every backdrop-filter has its -webkit- twin`, () => {
      const d = declarations(css(file));
      const plain = d.filter((x) => /^backdrop-filter\s*:/.test(x));
      for (const x of plain) expect(d, x).toContain(`-webkit-${x}`);
      expect(d.filter((x) => /^-webkit-backdrop-filter\s*:/.test(x)).length).toBe(plain.length);
    });

    it(`${file}: every viewport-height size has its dvh twin in the same rule, or in an @supports rule for the same selector`, () => {
      const rules = parse(css(file));
      let found = 0;
      for (const rule of rules) {
        for (const decl of rule.decls) {
          const [property, value] = [decl.slice(0, decl.indexOf(':')).trim(), decl.slice(decl.indexOf(':') + 1)];
          if (!SIZES.test(property) || !/\dvh/.test(value) || /dvh/.test(value)) continue;
          found++;
          const name = `${rule.context.join(' ')} ${rule.selector} { ${decl} }`;
          const twin = (r: Rule) => r.decls.some((d) => d.startsWith(`${property}:`) && /dvh/.test(d));
          const here = rule.decls.slice(rule.decls.indexOf(decl) + 1).some((d) => d.startsWith(`${property}:`) && /dvh/.test(d));
          // A custom property is only checked where it is used, so it cannot fall back to its vh value when dvh is
          // unknown: it is set again inside @supports instead, for the same selector and media.
          const supported = rules.some((r) => r !== rule && r.selector === rule.selector && r.context.includes(SUPPORTS) && sameMedia(r, rule) && twin(r));
          expect(property.startsWith('--') ? supported : here || supported, name).toBe(true);
        }
      }
      if (file === 'ui/style.css') expect(found).toBeGreaterThan(5);
    });

    it(`${file}: every dvh size has a vh one before it in the rule, or sits inside @supports`, () => {
      for (const rule of parse(css(file))) {
        rule.decls.forEach((decl, k) => {
          const property = decl.slice(0, decl.indexOf(':')).trim();
          if (!SIZES.test(property) || !/dvh/.test(decl) || rule.context.includes(SUPPORTS)) return;
          expect(rule.decls.slice(0, k).some((d) => d.startsWith(`${property}:`) && /vh/.test(d) && !/dvh/.test(d)), `${rule.selector} { ${decl} }`).toBe(true);
        });
      }
    });
  }
});
