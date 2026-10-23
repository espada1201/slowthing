import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Safari before 18 only knows backdrop-filter with its prefix, and before 15.4 has no dvh unit. The styles must still
// work there: a fallback beside each.

const css = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const declarations = (text: string) => text.split(/[;{}]/).map((d) => d.trim());

describe('styles for older Safari', () => {
  for (const file of ['ui/style.css', 'kit/kit.css']) {
    it(`${file}: every backdrop-filter has its -webkit- twin`, () => {
      const d = declarations(css(file));
      const plain = d.filter((x) => /^backdrop-filter\s*:/.test(x));
      for (const x of plain) expect(d, x).toContain(`-webkit-${x}`);
      expect(d.filter((x) => /^-webkit-backdrop-filter\s*:/.test(x)).length).toBe(plain.length);
    });

    it(`${file}: a dvh declaration has a vh one before it in the rule, or sits inside @supports`, () => {
      const text = css(file);
      const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      let found = 0;
      for (const [, selector, body] of rules) {
        const decls = body.split(';').map((d) => d.trim()).filter(Boolean);
        decls.forEach((decl, k) => {
          if (!decl.includes('dvh')) return;
          found++;
          const property = decl.split(':')[0].trim();
          const name = `${selector.trim()} { ${decl} }`;
          // A custom property is only checked when it is used, so it cannot fall back: it must not be set at all without dvh.
          if (property.startsWith('--')) expect(text, name).toMatch(/@supports\s*\(\s*height\s*:\s*100dvh\s*\)\s*\{[^{}]*\{[^{}]*dvh/);
          else expect(decls.slice(0, k).some((d) => d.startsWith(`${property}:`) && /vh/.test(d) && !d.includes('dvh')), name).toBe(true);
        });
      }
      if (file === 'ui/style.css') expect(found).toBeGreaterThan(0);
    });
  }
});
