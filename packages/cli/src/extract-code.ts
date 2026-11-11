import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { unitSchema, type SourceUnit } from '@everylocale/core';

/** Component names whose `id` and `defaultMessage` props declare a message. */
const COMPONENTS: ReadonlySet<string> = new Set(['Message', 'FormattedMessage']);

/**
 * Extraction recognizes explicit declarations (`id` plus `defaultMessage`), never arbitrary
 * strings. Context comes only from the declaration's `description`, so moving a message to
 * another file or checkout does not change its source revision. A declaration whose id or
 * default message is not a string literal cannot be extracted and is an error.
 */
export async function extractCode(files: readonly string[], root: string): Promise<SourceUnit[]> {
  const messages = new Map<string, SourceUnit>();
  const errors: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const where = (node: ts.Node) => {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${relative(root, file).replaceAll('\\', '/')}:${line + 1}`;
    };
    const declare = (node: ts.Node, props: ReadonlyMap<string, ts.Node | undefined>) => {
      if (!props.has('defaultMessage')) return;
      const id = literal(props.get('id'));
      const defaultMessage = literal(props.get('defaultMessage'));
      const description = props.has('description') ? literal(props.get('description')) : '';
      if (!id || !defaultMessage || description === undefined) {
        errors.push(
          `${where(node)}: id, defaultMessage and description must be string literals to be extracted`,
        );
        return;
      }
      const unit = unitSchema.parse({
        id,
        source: defaultMessage,
        kind: 'icu',
        context: description,
      });
      const previous = messages.get(id);
      if (previous && (previous.source !== unit.source || previous.context !== unit.context))
        errors.push(
          `${where(node)}: ${id} is declared with a different default message or description`,
        );
      messages.set(id, unit);
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(source);
        const [input] = node.arguments;
        if (
          (name === 'defineMessage' || name.endsWith('.formatMessage')) &&
          input &&
          ts.isObjectLiteralExpression(input)
        )
          declare(input, objectProps(input, source));
        if (name === 'defineMessages' && input && ts.isObjectLiteralExpression(input))
          for (const property of input.properties)
            if (
              ts.isPropertyAssignment(property) &&
              ts.isObjectLiteralExpression(property.initializer)
            )
              declare(property.initializer, objectProps(property.initializer, source));
      }
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        COMPONENTS.has(node.tagName.getText(source))
      )
        declare(node, jsxProps(node, source));
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return [...messages.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function literal(node: ts.Node | undefined): string | undefined {
  if (node && ts.isJsxExpression(node)) return literal(node.expression);
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}
function objectProps(node: ts.ObjectLiteralExpression, source: ts.SourceFile) {
  return new Map(
    node.properties
      .filter(ts.isPropertyAssignment)
      .map((item) => [item.name.getText(source).replace(/^['"]|['"]$/g, ''), item.initializer]),
  );
}
function jsxProps(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement, source: ts.SourceFile) {
  return new Map(
    node.attributes.properties
      .filter(ts.isJsxAttribute)
      .map((item) => [item.name.getText(source), item.initializer]),
  );
}
