import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { unitSchema, type SourceUnit } from '@everylocale/core';

/** Extraction recognizes declarations, not arbitrary business strings. */
export async function extractCode(files: string[]): Promise<SourceUnit[]> {
  const messages = new Map<string, SourceUnit>();
  const literal = (node: ts.Node | undefined): string | undefined =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : undefined;
  const add = (id: string | undefined, source: string | undefined, context: string) => {
    if (!id || !source) return;
    const unit = unitSchema.parse({ id, source, kind: 'icu', context });
    const previous = messages.get(id);
    if (previous && previous.source !== source)
      throw new Error(`Conflicting default messages for ${id}`);
    messages.set(id, unit);
  };
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const root = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const descriptor = (node: ts.ObjectLiteralExpression) => {
      const values = new Map(
        node.properties
          .filter(ts.isPropertyAssignment)
          .map((x) => [x.name.getText(root).replace(/^['"]|['"]$/g, ''), literal(x.initializer)]),
      );
      add(values.get('id'), values.get('defaultMessage'), values.get('description') ?? file);
    };
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(root);
        const input = node.arguments[0];
        if (
          (name === 'defineMessage' || name.endsWith('.formatMessage')) &&
          input &&
          ts.isObjectLiteralExpression(input)
        )
          descriptor(input);
        if (name === 'defineMessages' && input && ts.isObjectLiteralExpression(input))
          for (const property of input.properties)
            if (
              ts.isPropertyAssignment(property) &&
              ts.isObjectLiteralExpression(property.initializer)
            )
              descriptor(property.initializer);
      }
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        if (['Message', 'FormattedMessage'].includes(node.tagName.getText(root))) {
          const values = new Map<string, string | undefined>();
          for (const attr of node.attributes.properties)
            if (ts.isJsxAttribute(attr))
              values.set(
                attr.name.getText(root),
                ts.isJsxExpression(attr.initializer ?? node)
                  ? literal((attr.initializer as ts.JsxExpression).expression)
                  : literal(attr.initializer),
              );
          add(values.get('id'), values.get('defaultMessage'), values.get('description') ?? file);
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(root);
  }
  return [...messages.values()].sort((a, b) => a.id.localeCompare(b.id));
}
