"use strict";
const parse = require('babylon').parse;
const generate = require('babel-generator').default;
const traverse = require('babel-traverse').default;
const t = require('babel-types');
const fs = require('fs');

const defineStatementPaths = [];
let registryId;
let registryPath;
const visitor = {
  ObjectExpression(path, state) {
    if (path.parent.type === 'VariableDeclarator' &&
        path.parent.id.name === 'registry') {
      registryId = path.parent.id;
      //console.log(path);
      registryPath = path;
    }
  },
  CallExpression(path, state) {
    if (path.node.callee.name === 'define') {
      defineStatementPaths.push(path.parentPath);
    }
  }
}

const code = '(function () {\n'+
'var registry = {};\n'+
'define("a", ["exports", "b"], function (exports, b) {\n'+
  'exports.default = "a";\n'+
'});\n'+
'define("b", ["exports"], function (exports) {\n'+
'exports.default = "b";\n'+
'});\n'+
'})();\n';

const ast = parse(code);

traverse(ast, visitor);

// node = BlockStatement, parent = FunctionExpression, key = 'body'
const blockStatementPath = defineStatementPaths[0].parentPath;

const start = defineStatementPaths[0].key;
const end = defineStatementPaths[1].key+1;

const head = blockStatementPath.node.body.slice(0, start)
const tail = blockStatementPath.node.body.slice(end);

const body = [];

const registryProps = [];

defineStatementPaths.forEach((defineStatementPath) => {
  let nameLiteral = defineStatementPath.node.expression.arguments[0];
  registryProps.push(
    t.objectProperty(nameLiteral, t.objectExpression([]))
  );
});

registryPath.replaceWith(t.objectExpression(registryProps));

defineStatementPaths.reverse().forEach((defineStatementPath) => {
  // moduleName
  let nameLiteral = defineStatementPath.node.expression.arguments[0];
  // deps
  let arrayExpression = defineStatementPath.node.expression.arguments[1];
  // function
  let funcExpression = defineStatementPath.node.expression.arguments[2];

  let args = arrayExpression.elements.map((literal) => {
    if (literal.value === 'exports') {
      return t.memberExpression(
        registryId,
        nameLiteral,
        true
      );
    }
    return t.memberExpression(
      registryId,
      literal,
      true
    );
  });

  body.push(
    t.expressionStatement(
      t.callExpression(funcExpression, args)
    )
  );
});

const newBlockStatement = t.blockStatement(head.concat(body, tail));

blockStatementPath.replaceWith(newBlockStatement);

const output = generate(ast, {
  sourceMaps: true,
  sourceMapTarget: 'foo.js.map',
  sourceRoot: '/',
  sourceFileName: 'src/foo.js'
}, code);

fs.writeFileSync('foo.js', output.code);
fs.writeFileSync('foo.js.map', JSON.stringify(output.map));